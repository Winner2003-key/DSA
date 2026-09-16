'use client';

import type { BibleCharacter, GraphNode, GroupKind, NodeType, ReviewStatus } from '@dsa/core';
import { NODE_TYPES } from '@dsa/core';
import { useMemo, useState } from 'react';
import { GROUP_KIND_LABEL, NODE_TYPE_LABEL, REVIEW_STATUSES, REVIEW_STATUS_LABEL, plural } from '../../lib/labels';
import { searchCharacters } from '../../lib/search';
import { buildTree, subtreeSize } from '../../lib/tree';
import { useEditorStore } from '../../store/editor-store';
import { StatusBadge } from '../ui';
import { ListField, NumberField, ReadOnly, Section, SelectField, TextArea, TextField } from './fields';

const GROUP_KINDS: GroupKind[] = ['CLASSE', 'TOME', 'ALIAS', 'OTHER'];

export function NodeInspector({ node, onJump }: { node: GraphNode; onJump: (nodeId: string) => void }) {
  const present = useEditorStore((s) => s.present);
  const updateNode = useEditorStore((s) => s.updateNode);
  const addChild = useEditorStore((s) => s.addChild);
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const addCharacter = useEditorStore((s) => s.addCharacter);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);

  const tree = useMemo(() => buildTree(present?.nodes ?? [], present?.edges ?? []), [present?.nodes, present?.edges]);
  const doomed = useMemo(() => subtreeSize(tree, node.id), [tree, node.id]);
  const character = present?.characters.find((c) => c.id === node.characterId) ?? null;
  const parentEdge = tree.parentEdges.get(node.id)?.[0] ?? null;
  const parent = parentEdge ? tree.nodesById.get(parentEdge.fromNodeId) : undefined;
  const childEdges = tree.childEdges.get(node.id) ?? [];

  const patch = (fields: Partial<GraphNode>, mergeKey?: string) => updateNode(node.id, fields, mergeKey);
  const patchMeta = (fields: Record<string, unknown>, mergeKey?: string) => patch({ metadata: { ...node.metadata, ...fields } }, mergeKey);

  return (
    <div className="pb-6">
      <Section title="Identité">
        <ReadOnly label="Clé du nœud">
          <span className="book text-[12px]">{node.nodeKey}</span>
        </ReadOnly>
        <SelectField
          label="Type"
          value={node.nodeType}
          options={NODE_TYPES.map((type) => ({ value: type, label: NODE_TYPE_LABEL[type] }))}
          onChange={(nodeType: NodeType) => patch({ nodeType })}
        />
        <TextField label={node.nodeType === 'CHARACTER' ? 'Nom (tel qu’imprimé)' : 'Libellé'} value={node.label} book onChange={(label) => patch({ label }, `label:${node.id}`)} />
        <TextField
          label={node.nodeType === 'CHARACTER' ? 'Indice (question posée)' : 'Question'}
          value={node.question ?? ''}
          book
          placeholder={node.nodeType === 'CHARACTER' ? 'Le révolté' : 'Formulation du livre'}
          onChange={(question) => patch({ question: question.trim() === '' ? null : question }, `question:${node.id}`)}
        />
        <TextArea
          label="Description (carte du Tireur)"
          value={node.description ?? ''}
          book
          rows={2}
          placeholder="Le révolté · NÉS À HÉBRON"
          onChange={(description) => patch({ description: description.trim() === '' ? null : description }, `description:${node.id}`)}
        />
        {node.nodeType === 'GROUP' && (
          <SelectField
            label="Type de groupe"
            value={(node.metadata.group_kind ?? 'OTHER') as GroupKind}
            options={GROUP_KINDS.map((kind) => ({ value: kind, label: GROUP_KIND_LABEL[kind] }))}
            onChange={(group_kind) => patchMeta({ group_kind })}
            hint="Affichage seulement. TOME et CLASSE restent de vraies questions, posées dans l’ordre du livre."
          />
        )}
      </Section>

      <Section title="Source">
        <NumberField label="Page du PDF" value={node.sourcePage} onChange={(sourcePage) => patch({ sourcePage })} hint="Le PDF n’est pas hébergé : le numéro sert à retrouver la page dans le livre." />
        <NumberField
          label="Page imprimée"
          value={typeof node.metadata.printed_page === 'number' ? node.metadata.printed_page : null}
          onChange={(printed_page) => patchMeta({ printed_page: printed_page ?? undefined })}
        />
        <ListField
          label="Pages supplémentaires"
          values={(Array.isArray(node.metadata.extra_pages) ? node.metadata.extra_pages : []).map(String)}
          onChange={(values) => patchMeta({ extra_pages: values.map((v) => Number.parseInt(v, 10)).filter((n) => Number.isFinite(n)) })}
          hint="Une par ligne."
        />
      </Section>

      {node.nodeType === 'CHARACTER' && (
        <Section title="Personnage">
          <CharacterPicker
            characters={present?.characters ?? []}
            selected={character}
            onAssign={(characterId) => patch({ characterId })}
            onCreate={() => {
              const created: BibleCharacter = {
                id: crypto.randomUUID(),
                name: node.label,
                nameFr: node.label,
                nameEn: null,
                gender: null,
                testament: null,
                description: node.description,
                aliases: [],
                isActive: true,
                metadata: { origin: 'admin', node_key: node.nodeKey },
              };
              addCharacter(created);
              patch({ characterId: created.id });
            }}
          />
        </Section>
      )}

      <Section title="Revue">
        <SelectField
          label="Statut"
          value={node.reviewStatus}
          options={REVIEW_STATUSES.map((status) => ({ value: status, label: REVIEW_STATUS_LABEL[status] }))}
          onChange={(reviewStatus: ReviewStatus) => patch({ reviewStatus })}
          hint="Seuls les nœuds validés sont jouables."
        />
        <TextArea label="Note de revue" value={node.reviewNote ?? ''} rows={2} onChange={(reviewNote) => patch({ reviewNote: reviewNote.trim() === '' ? null : reviewNote }, `note:${node.id}`)} />
      </Section>

      <Section title="Métadonnées">
        <ListField label="Notes" values={toStringList(node.metadata.notes)} onChange={(notes) => patchMeta({ notes })} hint="Une par ligne." />
        <ListField label="Variantes" values={toStringList(node.metadata.variants)} onChange={(variants) => patchMeta({ variants })} hint="Autres graphies rencontrées dans le livre." />
        <details>
          <summary className="cursor-pointer text-[11px] text-ink-soft">JSON complet (lecture seule)</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-sm border border-rule bg-surface-sunk p-2 text-[11px] leading-relaxed">
            {JSON.stringify(node.metadata, null, 2)}
          </pre>
        </details>
      </Section>

      <Section title="Structure">
        <div className="space-y-1">
          {parent ? (
            <button type="button" className="block w-full truncate rounded-sm px-1 py-0.5 text-left hover:bg-surface-sunk" onClick={() => onJump(parent.id)}>
              <span className="text-ink-faint">Parent · </span>
              <span className="book">{parent.label}</span>
              {parentEdge && <span className="text-ink-faint"> ({parentEdge.answerLabel})</span>}
            </button>
          ) : (
            <p className="text-ink-faint">Aucun parent (racine).</p>
          )}
          <p className="text-ink-faint">{childEdges.length === 0 ? 'Aucun enfant.' : plural(childEdges.length, 'enfant')}</p>
        </div>

        {adding ? (
          <AddChildForm
            parentType={node.nodeType}
            onCancel={() => setAdding(false)}
            onCreate={(init) => {
              const created = addChild(node.id, {
                ...init,
                position:
                  node.positionX !== null && node.positionY !== null
                    ? { x: node.positionX + childEdges.length * 40, y: node.positionY + 148 }
                    : undefined,
              });
              setAdding(false);
              if (created) onJump(created);
            }}
          />
        ) : (
          <button type="button" className="btn w-full" onClick={() => setAdding(true)}>
            Ajouter un enfant
          </button>
        )}

        {confirmDelete ? (
          <div className="rounded-sm border border-rejected/40 bg-rejected-soft p-2">
            <p className="text-rejected">
              Supprimer « {node.label} » retire {plural(doomed.nodes, 'nœud')} (le nœud et ses descendants) et {plural(doomed.edges, 'arête')}.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn btn-danger flex-1"
                onClick={() => {
                  deleteNode(node.id);
                  setConfirmDelete(false);
                }}
              >
                Supprimer
              </button>
              <button type="button" className="btn flex-1" onClick={() => setConfirmDelete(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-danger w-full" onClick={() => setConfirmDelete(true)} disabled={node.nodeType === 'START'}>
            Supprimer le nœud
          </button>
        )}
      </Section>

      <div className="px-3">
        <StatusBadge status={node.reviewStatus} />
      </div>
    </div>
  );
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function CharacterPicker({
  characters,
  selected,
  onAssign,
  onCreate,
}: {
  characters: readonly BibleCharacter[];
  selected: BibleCharacter | null;
  onAssign: (id: string | null) => void;
  onCreate: () => void;
}) {
  const [term, setTerm] = useState('');
  const hits = useMemo(() => searchCharacters(characters, term, 8), [characters, term]);

  return (
    <div className="space-y-2">
      {selected ? (
        <div className="rounded-sm border border-rule bg-surface-sunk px-2 py-1.5">
          <div className="book text-[14px] font-medium">{selected.name}</div>
          {selected.description && <div className="book text-[12px] italic text-ink-soft">{selected.description}</div>}
          {selected.aliases.length > 0 && <div className="mt-0.5 text-[11px] text-ink-faint">Alias : {selected.aliases.join(', ')}</div>}
          <button type="button" className="mt-1 text-[11px] text-rejected underline-offset-2 hover:underline" onClick={() => onAssign(null)}>
            Détacher
          </button>
        </div>
      ) : (
        <p className="rounded-sm border border-review/40 bg-review-soft px-2 py-1.5 text-review">
          Aucun personnage rattaché : ce nœud ne sera pas jouable.
        </p>
      )}

      <input className="field" placeholder="Chercher un personnage…" value={term} onChange={(e) => setTerm(e.target.value)} />
      {hits.length > 0 && (
        <ul className="max-h-52 divide-y divide-rule overflow-auto rounded-sm border border-rule">
          {hits.map((hit) => (
            <li key={hit.character.id}>
              <button
                type="button"
                className="block w-full px-2 py-1.5 text-left hover:bg-surface-sunk"
                onClick={() => {
                  onAssign(hit.character.id);
                  setTerm('');
                }}
              >
                <span className="book text-[14px]">{hit.character.name}</span>
                {hit.character.description && <span className="book block text-[11px] italic text-ink-faint">{hit.character.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {term.trim() !== '' && hits.length === 0 && <p className="text-ink-faint">Aucun résultat.</p>}

      <button type="button" className="btn w-full" onClick={onCreate}>
        Créer un personnage depuis ce nœud
      </button>
    </div>
  );
}

function AddChildForm({
  parentType,
  onCreate,
  onCancel,
}: {
  parentType: NodeType;
  onCreate: (init: { nodeType: NodeType; label: string; question: string | null; answerLabel?: string }) => void;
  onCancel: () => void;
}) {
  const [nodeType, setNodeType] = useState<NodeType>(parentType === 'QUESTION' ? 'CATEGORY' : 'CHARACTER');
  const [label, setLabel] = useState('');
  const [question, setQuestion] = useState('');

  return (
    <form
      className="space-y-2 rounded-sm border border-rule bg-surface-sunk p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (label.trim() === '') return;
        onCreate({ nodeType, label: label.trim(), question: question.trim() === '' ? null : question.trim() });
      }}
    >
      <SelectField
        label="Type de l’enfant"
        value={nodeType}
        options={NODE_TYPES.map((type) => ({ value: type, label: NODE_TYPE_LABEL[type] }))}
        onChange={setNodeType}
      />
      <TextField label={nodeType === 'CHARACTER' ? 'Nom' : 'Libellé'} value={label} book onChange={setLabel} />
      {nodeType === 'CHARACTER' && <TextField label="Indice" value={question} book onChange={setQuestion} />}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary flex-1" disabled={label.trim() === ''}>
          Ajouter
        </button>
        <button type="button" className="btn flex-1" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
