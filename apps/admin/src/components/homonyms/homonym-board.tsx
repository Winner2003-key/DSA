'use client';

import type { GraphData } from '@dsa/core';
import { useEffect, useMemo, useState } from 'react';
import { RepositoryError } from '../../lib/graph-repository';
import { draftDiff, toGraphData, useEditorStore } from '../../store/editor-store';
import {
  filterHomonyms,
  findHomonyms,
  homonymStats,
  suggestDescription,
  type HomonymFilter,
  type HomonymGroup,
  type HomonymPerson,
} from '../../lib/homonyms';
import { plural } from '../../lib/labels';
import { getBrowserRepository } from '../../lib/repository-browser';
import { buildTree, type GraphTree } from '../../lib/tree';
import { SaveDialog } from '../editor/save-dialog';
import { GuardedLink, useUnsavedCount } from '../guarded-link';
import { Notice, Stat, StatusBadge } from '../ui';
import { CARD_WIDTH, TireurCardPreview, type CardScheme } from './tireur-card-preview';

const FILTERS: { value: HomonymFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'WEAK', label: 'Descriptions faibles' },
  { value: 'EDITED', label: 'Déjà modifiées' },
  { value: 'IDENTICAL', label: 'Identiques' },
];

/**
 * People who share a name, laid side by side as the Tireur would see their
 * cards. The description is the only thing that tells two JACQUES apart on the
 * card, so this page is where it gets written. Edits go into the same editor
 * store as the graph editor and are saved with the same diff.
 */
export function HomonymBoard({ slug }: { slug: string }) {
  const load = useEditorStore((s) => s.load);
  const baseline = useEditorStore((s) => s.baseline);
  const present = useEditorStore((s) => s.present);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const markSaved = useEditorStore((s) => s.markSaved);
  const unsaved = useUnsavedCount();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HomonymFilter>('ALL');
  const [search, setSearch] = useState('');
  const [scheme, setScheme] = useState<CardScheme>('dark');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await (await getBrowserRepository()).loadGraph(slug);
        if (cancelled) return;
        load(data);
        setLoadError(null);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof RepositoryError ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, load]);

  useEffect(() => {
    if (unsaved === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const tree = useMemo(() => buildTree(present?.nodes ?? [], present?.edges ?? []), [present?.nodes, present?.edges]);
  // Badges and counters follow the draft as you type…
  const groups = useMemo(() => (present ? findHomonyms(toGraphData(present), tree) : []), [present, tree]);
  // …but filter membership follows the saved graph, so a row does not vanish
  // from "Descriptions faibles" the moment its description becomes good enough.
  const savedGroups = useMemo(() => (baseline ? findHomonyms(baseline) : []), [baseline]);
  const stats = useMemo(() => homonymStats(groups), [groups]);

  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(({ value }) => [value, filterHomonyms(savedGroups, value).length])) as Record<HomonymFilter, number>,
    [savedGroups],
  );
  const visible = useMemo(() => {
    const keys = new Set(filterHomonyms(savedGroups, filter, search).map((group) => group.key));
    return groups.filter((group) => keys.has(group.key));
  }, [savedGroups, groups, filter, search]);

  const diff = useMemo(() => draftDiff(baseline, present), [baseline, present]);

  if (loading) return <div className="flex h-full items-center justify-center text-ink-soft">Chargement du graphe…</div>;
  if (loadError || !present || !baseline)
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <Notice tone="error">{loadError ?? 'Graphe introuvable.'}</Notice>
        <p className="mt-3">
          <GuardedLink className="btn" href="/graphes">
            Retour aux graphes
          </GuardedLink>
        </p>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-20 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 text-ink-faint">
              <GuardedLink href="/graphes" className="hover:text-ink">
                Graphes
              </GuardedLink>
              <span>›</span>
              <span className="truncate">{present.graph.name}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Homonymes</h1>
          </div>

          <div className="flex gap-6">
            <Stat label="noms partagés" value={stats.names.toLocaleString('fr-FR')} />
            <Stat label="personnes" value={stats.people.toLocaleString('fr-FR')} />
            <Stat label="descriptions faibles ou identiques" value={stats.unresolved.toLocaleString('fr-FR')} tone={stats.unresolved > 0 ? 'review' : undefined} />
            <Stat label="déjà modifiées" value={stats.edited.toLocaleString('fr-FR')} />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <GuardedLink href={`/graphes/${slug}`} className="btn">
              Éditeur
            </GuardedLink>
            <GuardedLink href={`/graphes/${slug}/revue`} className="btn">
              Revue
            </GuardedLink>
            <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
              Annuler
            </button>
            <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)">
              Rétablir
            </button>
            <button type="button" className="btn btn-primary" disabled={unsaved === 0} onClick={() => setSaving(true)}>
              Enregistrer{unsaved > 0 ? ` (${unsaved})` : ''}
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-5 pb-2.5">
          <div className="flex overflow-hidden rounded-sm border border-rule-strong" role="radiogroup" aria-label="Filtre">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                className={`border-r border-rule-strong px-2.5 py-1.5 font-medium last:border-0 ${
                  filter === value ? 'bg-ink text-white' : 'bg-surface text-ink-soft hover:bg-surface-sunk hover:text-ink'
                }`}
                onClick={() => setFilter(value)}
              >
                {label} <span className={`tabular ${filter === value ? 'text-white/70' : 'text-ink-faint'}`}>{filterCounts[value]}</span>
              </button>
            ))}
          </div>
          <input className="field w-56" placeholder="Chercher un nom…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <label className="ml-auto flex items-center gap-1.5 text-ink-soft">
            <input type="checkbox" checked={scheme === 'light'} onChange={(event) => setScheme(event.target.checked ? 'light' : 'dark')} />
            Aperçu en thème clair
          </label>
        </div>
      </div>

      <main className="mx-auto max-w-[1500px] px-5 pb-16 pt-4">
        <p className="max-w-[80ch] text-ink-soft">
          La carte du Tireur n’affiche la description que lorsqu’une autre personne du livre porte le même nom : c’est alors la seule indication
          de <em>laquelle</em> faire découvrir. Les filtres portent sur la version enregistrée ; les badges suivent vos modifications.
        </p>

        {groups.length === 0 && (
          <div className="panel mt-5 rounded-md px-5 py-8 text-center text-ink-soft">Aucun nom n’est porté par deux personnes différentes dans ce graphe.</div>
        )}
        {groups.length > 0 && visible.length === 0 && (
          <div className="panel mt-5 rounded-md px-5 py-8 text-center text-ink-soft">
            Aucun nom dans ce filtre.{' '}
            <button
              type="button"
              className="text-accent underline underline-offset-2"
              onClick={() => {
                setFilter('ALL');
                setSearch('');
              }}
            >
              Tout afficher
            </button>
          </div>
        )}

        <div className="mt-5 space-y-5">
          {visible.map((group) => (
            <GroupBlock key={group.key} slug={slug} group={group} tree={tree} baseline={baseline} scheme={scheme} />
          ))}
        </div>
      </main>

      {saving && diff && (
        <SaveDialog
          diff={diff}
          onCancel={() => setSaving(false)}
          onSaved={(message) => {
            markSaved();
            setSaving(false);
            setToast(message);
            window.setTimeout(() => setToast(null), 6000);
          }}
        />
      )}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-sm border border-approved/35 bg-approved-soft px-3 py-2 text-approved shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}

function GroupBlock({ slug, group, tree, baseline, scheme }: { slug: string; group: HomonymGroup; tree: GraphTree; baseline: GraphData; scheme: CardScheme }) {
  const identical = group.people.some((person) => person.identical);
  return (
    <section className={`panel rounded-md ${identical ? 'border-l-4 border-l-rejected' : ''}`} aria-labelledby={`name-${group.key}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5">
        <h2 id={`name-${group.key}`} className="book text-[22px] font-semibold leading-tight">
          {group.name}
        </h2>
        <span className="text-ink-soft">{plural(group.people.length, 'personne')}</span>
        {identical && (
          <span className="rounded-xs border border-rejected/40 bg-rejected-soft px-1.5 py-px text-[11px] font-medium text-rejected">
            Descriptions identiques : le Tireur ne peut pas les distinguer
          </span>
        )}
      </header>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_WIDTH + 58}px, 1fr))` }}>
        {group.people.map((person) => (
          <PersonColumn key={person.key} slug={slug} person={person} tree={tree} baseline={baseline} scheme={scheme} />
        ))}
      </div>
    </section>
  );
}

function PersonColumn({ slug, person, tree, baseline, scheme }: { slug: string; person: HomonymPerson; tree: GraphTree; baseline: GraphData; scheme: CardScheme }) {
  const setCardDescription = useEditorStore((s) => s.setCardDescription);
  const suggestion = useMemo(() => suggestDescription(tree, person.node.id), [tree, person.node.id]);
  const saved = useMemo(() => {
    const character = person.character ? baseline.characters.find((c) => c.id === person.character?.id) : undefined;
    return character?.description ?? baseline.nodes.find((n) => n.id === person.node.id)?.description ?? null;
  }, [baseline, person.character, person.node.id]);
  const changed = (saved ?? '') !== (person.description ?? '');
  const fieldId = `description-${person.node.id}`;

  return (
    // A hairline on the right separates people; an empty cell stays blank.
    <article className="flex flex-col gap-3 p-4 shadow-[1px_0_0_var(--color-rule),0_1px_0_var(--color-rule)]">
      <TireurCardPreview name={person.node.label} description={person.description} scheme={scheme} />

      <div className="flex flex-wrap gap-1">
        <StatusBadge status={person.node.reviewStatus} />
        {person.weak && <Flag tone="review">Faible</Flag>}
        {person.identical && <Flag tone="rejected">Identique</Flag>}
        {person.edited && <Flag tone="accent">Modifiée</Flag>}
        {changed && <Flag tone="ink">Non enregistrée</Flag>}
        {!person.character && <Flag tone="rejected">Sans personnage</Flag>}
      </div>

      <div>
        <label className="field-label" htmlFor={fieldId}>
          Description de la carte
        </label>
        <textarea
          id={fieldId}
          className="field book resize-y text-[15px]"
          rows={2}
          value={person.description ?? ''}
          placeholder="Aucune description : la carte n’affiche que le nom"
          onChange={(event) => setCardDescription(person.node.id, event.target.value, `description:${person.node.id}`)}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn py-1"
            disabled={suggestion === '' || suggestion === person.description}
            title={suggestion ? `Proposition : ${suggestion}` : 'Pas assez de contexte dans le livre'}
            onClick={() => setCardDescription(person.node.id, suggestion)}
          >
            Suggérer
          </button>
          {suggestion && suggestion !== person.description && <span className="book min-w-0 truncate text-[12px] italic text-ink-faint">{suggestion}</span>}
        </div>
      </div>

      <div className="space-y-1.5 text-[12px]">
        <nav aria-label="Chemin dans le livre" className="book leading-snug text-ink-soft">
            {person.path.map((node, index) => (
              <span key={node.id}>
                {index > 0 && <span className="px-1 text-ink-faint">›</span>}
                <span className={index === person.path.length - 1 ? 'font-semibold text-ink' : ''}>
                  {node.nodeType === 'CHARACTER' && node.question ? `${node.question} • ${node.label}` : node.label}
                </span>
              </span>
            ))}
        </nav>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="tabular text-ink-soft">
            {person.node.sourcePage !== null ? `Source : page ${person.node.sourcePage}` : 'Sans page source'}
            {person.otherNodes.length > 0 && (
              <span className="text-ink-faint">
                {' '}
                · aussi {person.otherNodes.map((node) => (node.sourcePage !== null ? `p. ${node.sourcePage}` : 'sans page')).join(', ')}
              </span>
            )}
          </p>
          <p className="ml-auto">
            <GuardedLink href={`/graphes/${slug}?noeud=${person.node.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
              Ouvrir dans l’éditeur
            </GuardedLink>
          </p>
        </div>
      </div>
    </article>
  );
}

function Flag({ tone, children }: { tone: 'review' | 'rejected' | 'accent' | 'ink'; children: string }) {
  const toneClass = {
    review: 'border-review/40 bg-review-soft text-review',
    rejected: 'border-rejected/40 bg-rejected-soft text-rejected',
    accent: 'border-accent/35 bg-accent-soft text-accent-ink',
    ink: 'border-ink/30 bg-surface-sunk text-ink',
  }[tone];
  return <span className={`rounded-xs border px-1.5 py-px text-[11px] font-medium ${toneClass}`}>{children}</span>;
}
