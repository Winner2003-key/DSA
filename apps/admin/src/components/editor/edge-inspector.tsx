'use client';

import type { EdgeKind, GraphEdge, ReviewStatus } from '@dsa/core';
import { answerClass } from '@dsa/core';
import { useMemo, useState } from 'react';
import { CANONICAL_ANSWERS, EDGE_KIND_LABEL, REVIEW_STATUSES, REVIEW_STATUS_LABEL } from '../../lib/labels';
import { buildTree } from '../../lib/tree';
import { useEditorStore } from '../../store/editor-store';
import { ListField, NumberField, ReadOnly, Section, SelectField, TextArea } from './fields';

const EDGE_KINDS: EdgeKind[] = ['DECISION', 'HIERARCHY', 'SYSTEM'];

export function EdgeInspector({ edge, onJump }: { edge: GraphEdge; onJump: (nodeId: string) => void }) {
  const present = useEditorStore((s) => s.present);
  const updateEdge = useEditorStore((s) => s.updateEdge);
  const reorderEdge = useEditorStore((s) => s.reorderEdge);
  const deleteEdge = useEditorStore((s) => s.deleteEdge);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tree = useMemo(() => buildTree(present?.nodes ?? [], present?.edges ?? []), [present?.nodes, present?.edges]);
  const from = tree.nodesById.get(edge.fromNodeId);
  const to = tree.nodesById.get(edge.toNodeId);
  const siblings = tree.childEdges.get(edge.fromNodeId) ?? [];
  const at = siblings.findIndex((candidate) => candidate.id === edge.id);
  const cls = answerClass(edge.answerLabel);

  const patch = (fields: Partial<GraphEdge>, mergeKey?: string) => updateEdge(edge.id, fields, mergeKey);

  return (
    <div className="pb-6">
      <Section title="Réponse">
        <div>
          <span className="field-label">Code de réponse</span>
          <div className="flex flex-wrap gap-1">
            {CANONICAL_ANSWERS.map((label) => (
              <button
                key={label}
                type="button"
                className={`rounded-xs border px-1.5 py-1 text-[11px] font-semibold ${
                  edge.answerLabel === label ? 'border-accent bg-accent text-white' : 'border-rule-strong bg-surface hover:bg-surface-sunk'
                }`}
                onClick={() => patch({ answerLabel: label })}
              >
                {label}
              </button>
            ))}
          </div>
          <input className="field book mt-1.5 text-[14px]" value={edge.answerLabel} onChange={(e) => patch({ answerLabel: e.target.value }, `answer:${edge.id}`)} />
          <p className="mt-1 text-[11px] text-ink-faint">
            Classe : <span className={cls === 'AUTRE' ? 'font-medium text-rejected' : 'font-medium text-ink-soft'}>{cls}</span>
            {cls === 'AUTRE' && edge.edgeKind === 'DECISION' && ' — une arête de décision validée avec ce code est une erreur.'}
          </p>
        </div>
        <SelectField
          label="Type d’arête"
          value={edge.edgeKind}
          options={EDGE_KINDS.map((kind) => ({ value: kind, label: EDGE_KIND_LABEL[kind] }))}
          onChange={(edgeKind: EdgeKind) => patch({ edgeKind })}
        />
      </Section>

      <Section title="Position dans la fratrie">
        <div className="flex items-center gap-2">
          <span className="tabular rounded-sm border border-rule bg-surface-sunk px-2 py-1.5">
            {at >= 0 ? at + 1 : '?'} / {siblings.length}
          </span>
          <button type="button" className="btn flex-1" disabled={at <= 0} onClick={() => reorderEdge(edge.id, -1)}>
            Monter
          </button>
          <button type="button" className="btn flex-1" disabled={at < 0 || at >= siblings.length - 1} onClick={() => reorderEdge(edge.id, 1)}>
            Descendre
          </button>
        </div>
        <p className="text-[11px] text-ink-faint">
          L’ordre est celui du livre : les enfants sont demandés dans cet ordre, jamais par ordre alphabétique. <span className="tabular">order_index = {edge.orderIndex}</span>
        </p>
      </Section>

      <Section title="Extrémités">
        <div className="space-y-1">
          <button type="button" className="block w-full truncate rounded-sm px-1 py-0.5 text-left hover:bg-surface-sunk" onClick={() => from && onJump(from.id)}>
            <span className="text-ink-faint">De · </span>
            <span className="book">{from?.label ?? 'nœud inconnu'}</span>
          </button>
          <button type="button" className="block w-full truncate rounded-sm px-1 py-0.5 text-left hover:bg-surface-sunk" onClick={() => to && onJump(to.id)}>
            <span className="text-ink-faint">Vers · </span>
            <span className="book">{to?.label ?? 'nœud inconnu'}</span>
          </button>
        </div>
        <ReadOnly label="Identifiant">
          <span className="text-[11px]">{edge.id}</span>
        </ReadOnly>
      </Section>

      <Section title="Source">
        <NumberField label="Page du PDF" value={edge.sourcePage} onChange={(sourcePage) => patch({ sourcePage })} />
        <ListField
          commitOnBlur
          label="Variantes du code"
          values={(edge.metadata.source_variants ?? []).map((variant) => `${variant.label} (p. ${variant.page})`)}
          onChange={(values) =>
            patch({
              metadata: {
                ...edge.metadata,
                source_variants: values
                  .map((line) => {
                    const match = /^(.*?)\s*\(p\.\s*(\d+)\)$/.exec(line);
                    return match?.[1] && match[2] ? { label: match[1].trim(), page: Number.parseInt(match[2], 10) } : null;
                  })
                  .filter((variant): variant is { label: string; page: number } => variant !== null),
              },
            })
          }
          hint="Une par ligne, au format « OUIOUIOUIOUI (p. 32) ». Le code canonique reste celui de la page 2."
        />
      </Section>

      <Section title="Revue">
        <SelectField
          label="Statut"
          value={edge.reviewStatus}
          options={REVIEW_STATUSES.map((status) => ({ value: status, label: REVIEW_STATUS_LABEL[status] }))}
          onChange={(reviewStatus: ReviewStatus) => patch({ reviewStatus })}
        />
        <TextArea label="Note de revue" value={edge.reviewNote ?? ''} rows={2} onChange={(reviewNote) => patch({ reviewNote: reviewNote.trim() === '' ? null : reviewNote }, `note:${edge.id}`)} />
      </Section>

      <Section title="Suppression">
        {confirmDelete ? (
          <div className="rounded-sm border border-rejected/40 bg-rejected-soft p-2">
            <p className="text-rejected">
              Supprimer cette arête détache « {to?.label ?? '?'} » de « {from?.label ?? '?'} ». Le nœud reste, mais devient orphelin.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn btn-danger flex-1"
                onClick={() => {
                  deleteEdge(edge.id);
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
          <button type="button" className="btn btn-danger w-full" onClick={() => setConfirmDelete(true)}>
            Supprimer l’arête
          </button>
        )}
      </Section>
    </div>
  );
}
