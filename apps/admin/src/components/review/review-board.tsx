'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { approvePages, rejectPage, type ReviewResult } from '../../app/graphes/[slug]/revue/actions';
import { formatDateTime, plural } from '../../lib/labels';
import { isPageDone, type PageReview, type PageTreeItem } from '../../lib/review';
import { Notice, Stat, StatusBadge } from '../ui';

export function ReviewBoard({
  slug,
  graphName,
  reviews,
  open,
  openItems,
  unpaged,
}: {
  slug: string;
  graphName: string;
  reviews: PageReview[];
  open: PageReview | null;
  openItems: PageTreeItem[];
  unpaged: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [pending, startTransition] = useTransition();

  const done = reviews.filter(isPageDone).length;
  const toReview = reviews.reduce((sum, review) => sum + review.statuses.NEEDS_REVIEW, 0);
  const rejected = reviews.reduce((sum, review) => sum + review.statuses.REJECTED, 0);

  function run(action: () => Promise<ReviewResult>, after?: () => void) {
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  function toggle(page: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  const allSelected = reviews.length > 0 && selected.size === reviews.length;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <Link href="/graphes" className="text-ink-faint hover:text-ink">
              ← Graphes
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Revue de l’import</h1>
            <p className="text-ink-soft">{graphName} — comparez chaque page transcrite avec le livre imprimé.</p>
          </div>
          <div className="flex gap-6">
            <Stat label="pages terminées" value={`${done} / ${reviews.length}`} />
            <Stat label="lignes à relire" value={toReview.toLocaleString('fr-FR')} tone="review" />
            <Stat label="lignes rejetées" value={rejected.toLocaleString('fr-FR')} />
          </div>
          <div className="ml-auto flex gap-1.5">
            <Link href={`/graphes/${slug}/homonymes`} className="btn">
              Homonymes
            </Link>
            <Link href={`/graphes/${slug}`} className="btn">
              Ouvrir l’éditeur
            </Link>
          </div>
        </div>

        {result && (
          <div className="mt-4">
            <Notice tone={result.ok ? 'ok' : 'error'}>{result.message}</Notice>
          </div>
        )}

        {selected.size > 0 && (
          <div className="sticky top-0 z-10 mt-4 flex items-center gap-3 rounded-sm border border-accent/40 bg-accent-soft px-3 py-2">
            <span className="text-accent-ink">{plural(selected.size, 'page sélectionnée', 'pages sélectionnées')}</span>
            {confirmBulk ? (
              <>
                <span className="text-ink">
                  Approuver toutes les lignes des pages {[...selected].sort((a, b) => a - b).join(', ')} ? Elles deviendront jouables.
                </span>
                <button
                  type="button"
                  className="btn btn-primary ml-auto"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => approvePages(slug, [...selected]),
                      () => {
                        setSelected(new Set());
                        setConfirmBulk(false);
                      },
                    )
                  }
                >
                  {pending ? 'Approbation…' : 'Confirmer'}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmBulk(false)}>
                  Annuler
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary ml-auto" onClick={() => setConfirmBulk(true)}>
                  Approuver la sélection
                </button>
                <button type="button" className="btn" onClick={() => setSelected(new Set())}>
                  Désélectionner
                </button>
              </>
            )}
          </div>
        )}

        {reviews.length === 0 ? (
          <div className="panel mt-5 rounded-md px-5 py-8 text-center text-ink-soft">
            Aucune ligne n’a de page source. Lancez l’import du livre pour remplir la revue.
          </div>
        ) : (
          <div className="panel mt-4 overflow-x-auto rounded-md">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule text-[11px] text-ink-soft">
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(reviews.map((review) => review.page)))}
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Page</th>
                  <th className="px-2 py-2 text-right font-medium">Nœuds</th>
                  <th className="px-2 py-2 text-right font-medium">Arêtes</th>
                  <th className="px-2 py-2 text-right font-medium">Personnages</th>
                  <th className="px-2 py-2 font-medium">Revue</th>
                  <th className="px-2 py-2 font-medium">Dernier import</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => {
                  const isOpen = open?.page === review.page;
                  return (
                    <tr
                      key={review.page}
                      className={`border-b border-rule last:border-0 ${isOpen ? 'bg-accent-soft' : 'hover:bg-paper'}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner la page ${review.page}`}
                          checked={selected.has(review.page)}
                          onChange={() => toggle(review.page)}
                        />
                      </td>
                      <td className="tabular px-2 py-2 font-semibold">
                        <Link href={`/graphes/${slug}/revue?page=${review.page}`} scroll={false} className="hover:text-accent">
                          p. {review.page}
                        </Link>
                      </td>
                      <td className="tabular px-2 py-2 text-right">{review.nodes}</td>
                      <td className="tabular px-2 py-2 text-right">{review.edges}</td>
                      <td className="tabular px-2 py-2 text-right">{review.characters}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {isPageDone(review) ? (
                            <StatusBadge status="APPROVED" count={review.statuses.APPROVED} />
                          ) : (
                            <>
                              {review.statuses.NEEDS_REVIEW > 0 && <StatusBadge status="NEEDS_REVIEW" count={review.statuses.NEEDS_REVIEW} />}
                              {review.statuses.REJECTED > 0 && <StatusBadge status="REJECTED" count={review.statuses.REJECTED} />}
                              {review.statuses.DRAFT > 0 && <StatusBadge status="DRAFT" count={review.statuses.DRAFT} />}
                              {review.statuses.APPROVED > 0 && <StatusBadge status="APPROVED" count={review.statuses.APPROVED} />}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-ink-soft">
                        {review.batch ? (
                          <>
                            <span className={review.batch.status === 'APPLIED' ? 'text-ink' : 'text-review'}>{batchStatusLabel(review.batch.status)}</span>
                            <span className="text-ink-faint"> · {formatDateTime(review.batch.appliedAt ?? review.batch.createdAt)}</span>
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/graphes/${slug}/revue?page=${review.page}`} scroll={false} className="btn">
                          Ouvrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {unpaged > 0 && (
          <p className="mt-3 text-ink-faint">
            {`${plural(unpaged, 'nœud')} sans page source (le départ, les questions à code, les ajouts sans page) ${unpaged > 1 ? 'n’apparaissent' : 'n’apparaît'} pas dans ce tableau : relisez-les dans l’éditeur.`}
          </p>
        )}
      </main>

      {open && (
        <PageDetail
          key={open.page}
          slug={slug}
          review={open}
          items={openItems}
          pending={pending}
          onApprove={() => run(() => approvePages(slug, [open.page]))}
          onReject={(note) => run(() => rejectPage(slug, open.page, note))}
        />
      )}
    </div>
  );
}

function batchStatusLabel(status: string): string {
  return (
    {
      PENDING: 'En attente',
      VALIDATED: 'Simulation validée',
      APPLIED: 'Appliqué',
      FAILED: 'Échec',
      DISCARDED: 'Abandonné',
    }[status] ?? status
  );
}

function PageDetail({
  slug,
  review,
  items,
  pending,
  onApprove,
  onReject,
}: {
  slug: string;
  review: PageReview;
  items: PageTreeItem[];
  pending: boolean;
  onApprove: () => void;
  onReject: (note: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const rootId = review.rootIds[0];
  const report = review.batch?.report ?? null;
  const warnings = Array.isArray(report?.validation_warnings) ? (report.validation_warnings as unknown[]).map(String) : [];

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-rule bg-surface lg:w-[24rem] lg:border-l lg:border-t-0 xl:w-[34rem]">
      <div className="shrink-0 border-b border-rule px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Page {review.page}</h2>
          <Link href={`/graphes/${slug}/revue`} scroll={false} className="text-ink-faint hover:text-ink">
            Fermer
          </Link>
        </div>
        <p className="tabular text-ink-soft">
          {plural(review.nodes, 'nœud')}, {plural(review.edges, 'arête')}, {plural(review.characters, 'personnage')}
          {review.batch?.source && <span className="text-ink-faint"> · {review.batch.source.split('/').pop()}</span>}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={onApprove}>
            Approuver la page
          </button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => setRejecting((value) => !value)}>
            Rejeter
          </button>
          {rootId && (
            <Link href={`/graphes/${slug}?noeud=${rootId}`} className="btn">
              Modifier
            </Link>
          )}
        </div>

        {rejecting && (
          <div className="mt-3 space-y-2 rounded-sm border border-rejected/40 bg-rejected-soft p-2">
            <label className="field-label text-rejected!" htmlFor="reject-note">
              Ce qui ne correspond pas au livre
            </label>
            <textarea id="reject-note" className="field" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending || note.trim() === ''}
              onClick={() => {
                onReject(note);
                setRejecting(false);
              }}
            >
              Rejeter la page avec cette note
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ol className="space-y-px">
          {items.map(({ node, edge, depth }) => {
            const variants = toList(node.metadata.variants);
            const notes = toList(node.metadata.notes);
            const edgeVariants = edge?.metadata.source_variants ?? [];
            return (
              <li key={node.id} className="border-l border-rule py-1 pr-1" style={{ marginLeft: depth * 14, paddingLeft: 8 }}>
                <div className="flex items-baseline gap-2">
                  {edge && <span className="shrink-0 text-[10px] font-semibold text-ink-faint">{edge.answerLabel}</span>}
                  <span className="book min-w-0 flex-1">
                    {node.nodeType === 'CHARACTER' ? (
                      <>
                        {node.question && <span className="italic text-ink-soft">{node.question} • </span>}
                        <span className="font-semibold">{node.label}</span>
                      </>
                    ) : (
                      <span className="font-medium">{node.label}</span>
                    )}
                    {typeof node.metadata.qualifier === 'string' && <span className="italic text-ink-faint"> ({node.metadata.qualifier})</span>}
                  </span>
                  {node.reviewStatus !== 'APPROVED' && <StatusBadge status={node.reviewStatus} />}
                </div>
                {node.reviewNote && (
                  // A note survives approval (the importer keeps it too); once approved it is history, not a warning.
                  <p className={`mt-0.5 text-[12px] ${node.reviewStatus === 'APPROVED' ? 'text-ink-soft' : 'text-review'}`}>Note : {node.reviewNote}</p>
                )}
                {variants.length > 0 && <p className="book mt-0.5 text-[12px] text-ink-soft">Variantes : {variants.join(', ')}</p>}
                {notes.length > 0 && <p className="mt-0.5 text-[12px] text-ink-soft">{notes.join(' / ')}</p>}
                {edgeVariants.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    Code imprimé ailleurs : {edgeVariants.map((variant) => `${variant.label} (p. ${variant.page})`).join(', ')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {review.batch && (
          <section className="mt-5 border-t border-rule pt-3">
            <h3 className="text-[11px] font-semibold text-ink-soft">Rapport du dernier import</h3>
            <p className="mt-1 text-ink-soft">
              {batchStatusLabel(review.batch.status)} le {formatDateTime(review.batch.appliedAt ?? review.batch.createdAt)}
            </p>
            {warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px] text-review">
                {warnings.slice(0, 8).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {warnings.length > 8 && <li className="text-ink-faint">+{warnings.length - 8} autres (graphe entier)</li>}
              </ul>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-ink-soft">JSON du rapport</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded-sm border border-rule bg-surface-sunk p-2 text-[11px]">
                {JSON.stringify({ stats: review.batch.stats, report: review.batch.report }, null, 2)}
              </pre>
            </details>
          </section>
        )}
      </div>
    </aside>
  );
}

function toList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
