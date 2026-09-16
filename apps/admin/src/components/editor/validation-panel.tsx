'use client';

import { validateGraph, type ValidationIssue } from '@dsa/core';
import { useMemo } from 'react';
import { plural } from '../../lib/labels';
import { toGraphData, useEditorStore } from '../../store/editor-store';
import { Stat } from '../ui';

/**
 * `validateGraph` from `@dsa/core` run on the graph as it is in the editor, so
 * the answer matches what publishing will decide — before saving, not after.
 */
export function ValidationPanel({ onJumpToKey }: { onJumpToKey: (nodeKey: string) => void }) {
  const present = useEditorStore((s) => s.present);
  const report = useMemo(() => (present ? validateGraph(toGraphData(present)) : null), [present]);

  if (!report) return null;

  return (
    <div className="space-y-4 p-3 pb-6">
      <div className={`rounded-sm border px-3 py-2 ${report.ok ? 'border-approved/35 bg-approved-soft text-approved' : 'border-rejected/40 bg-rejected-soft text-rejected'}`}>
        {report.ok
          ? `Graphe valide — publication possible. ${plural(report.warnings.length, 'avertissement')}.`
          : `${plural(report.errors.length, 'erreur')} — la publication sera refusée.`}
      </div>

      <div className="grid grid-cols-3 gap-3 border-y border-rule py-3">
        <Stat label="Nœuds" value={report.stats.nodes.toLocaleString('fr-FR')} />
        <Stat label="Arêtes" value={report.stats.edges.toLocaleString('fr-FR')} />
        <Stat label="Personnages jouables" value={report.stats.playableCharacters.toLocaleString('fr-FR')} />
        <Stat label="Nœuds à relire" value={report.stats.needsReviewNodes.toLocaleString('fr-FR')} tone="review" />
        <Stat label="Arêtes à relire" value={report.stats.needsReviewEdges.toLocaleString('fr-FR')} tone="review" />
        <Stat label="Personnages" value={report.stats.characters.toLocaleString('fr-FR')} />
      </div>

      <IssueList title="Erreurs" issues={report.errors} tone="error" onJumpToKey={onJumpToKey} />
      <IssueList title="Avertissements" issues={report.warnings} tone="warn" onJumpToKey={onJumpToKey} />
    </div>
  );
}

function IssueList({
  title,
  issues,
  tone,
  onJumpToKey,
}: {
  title: string;
  issues: ValidationIssue[];
  tone: 'error' | 'warn';
  onJumpToKey: (nodeKey: string) => void;
}) {
  if (issues.length === 0) return null;
  const border = tone === 'error' ? 'border-rejected/30' : 'border-review/30';
  const text = tone === 'error' ? 'text-rejected' : 'text-review';
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-[0.02em] text-ink-soft">
        {title} <span className="tabular text-ink-faint">{issues.length}</span>
      </h3>
      <ul className="space-y-2">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className={`rounded-sm border ${border} bg-surface px-2 py-1.5`}>
            <div className={`text-[11px] font-semibold ${text}`}>{issue.code}</div>
            <p className="mt-0.5">{issue.message}</p>
            {issue.nodeKeys.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {issue.nodeKeys.slice(0, 6).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="book max-w-full truncate rounded-xs border border-rule bg-surface-sunk px-1 text-[11px] hover:border-accent hover:text-accent"
                    onClick={() => onJumpToKey(key)}
                    title={key}
                  >
                    {key.split('/').pop()}
                  </button>
                ))}
                {issue.nodeKeys.length > 6 && <span className="text-[11px] text-ink-faint">+{issue.nodeKeys.length - 6}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
