'use client';

import { useState } from 'react';
import { describeDiff, summarize, type GraphDiff } from '../../lib/diff';
import { getBrowserRepository } from '../../lib/repository-browser';

/**
 * The batch save. The admin sees exactly what is about to change, in French,
 * before anything is written; every row goes through their own session, so RLS
 * has the last word.
 */
export function SaveDialog({ diff, onCancel, onSaved }: { diff: GraphDiff; onCancel: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = summarize(diff);
  const lines = describeDiff(summary);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const repository = await getBrowserRepository();
      await repository.saveDiff(diff);
      onSaved(`Enregistré : ${lines.join(', ')}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6" role="dialog" aria-modal="true">
      <div className="panel w-full max-w-lg rounded-md p-5 shadow-lg">
        <h2 className="text-[15px] font-semibold">Enregistrer les modifications</h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-ink-soft">Rien à enregistrer.</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {lines.map((line) => (
              <li key={line} className="flex items-baseline gap-2 border-b border-rule pb-1 last:border-0">
                <span className="text-accent">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        {summary.nodesDeleted > 0 && (
          <p className="mt-3 rounded-sm border border-rejected/40 bg-rejected-soft px-2 py-1.5 text-rejected">
            Les suppressions sont définitives : les lignes correspondantes seront retirées de la base.
          </p>
        )}

        {error && <p className="mt-3 rounded-sm border border-rejected/40 bg-rejected-soft px-2 py-1.5 text-rejected">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || lines.length === 0}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
