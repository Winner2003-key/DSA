'use client';

import type { GraphStatus } from '@dsa/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { publishGraph, unpublishGraph, type PublishResult } from '../app/graphes/actions';

export function PublishControls({ slug, status }: { slug: string; status: GraphStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PublishResult | null>(null);

  function run(action: () => Promise<PublishResult>) {
    startTransition(async () => {
      try {
        const next = await action();
        setResult(next);
        if (next.ok) router.refresh();
      } catch (error) {
        setResult({ ok: false, message: error instanceof Error ? error.message : String(error), errors: [], report: null });
      }
    });
  }

  return (
    <>
      {status === 'PUBLISHED' ? (
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => unpublishGraph(slug))}>
          {pending ? '…' : 'Dépublier'}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => publishGraph(slug))}>
          {pending ? 'Validation…' : 'Publier'}
        </button>
      )}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6" role="dialog" aria-modal="true">
          <div className="panel max-h-[80vh] w-full max-w-2xl overflow-auto rounded-md p-5 text-left shadow-lg">
            <h2 className={`text-[15px] font-semibold ${result.ok ? 'text-approved' : 'text-rejected'}`}>
              {result.ok ? 'Publication effectuée' : 'Publication refusée'}
            </h2>
            <p className="mt-1 text-ink-soft">{result.message}</p>

            {result.errors.length > 0 && (
              <ul className="mt-4 space-y-2">
                {result.errors.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className="rounded-sm border border-rejected/30 bg-rejected-soft px-3 py-2">
                    <div className="font-medium text-rejected">{issue.code}</div>
                    <div className="mt-0.5 text-ink">{issue.message}</div>
                    {issue.nodeKeys.length > 0 && (
                      <div className="book mt-1 break-all text-[12px] text-ink-soft">{issue.nodeKeys.join(' · ')}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" className="btn" onClick={() => setResult(null)}>
                Fermer
              </button>
              {!result.ok && (
                <a className="btn btn-primary" href={`/graphes/${slug}`}>
                  Ouvrir l’éditeur
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
