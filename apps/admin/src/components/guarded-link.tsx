'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { draftSummary, useEditorStore } from '../store/editor-store';

/** Number of unsaved row changes in the editor store (0 when nothing is loaded). */
export function useUnsavedCount(): number {
  const baseline = useEditorStore((s) => s.baseline);
  const present = useEditorStore((s) => s.present);
  return draftSummary(baseline, present)?.total ?? 0;
}

/**
 * A link that asks before leaving a page with unsaved edits. `beforeunload`
 * only covers reloads and closed tabs; client-side navigation between the
 * editor and the Homonymes page would otherwise drop the draft silently.
 */
export function GuardedLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const unsaved = useUnsavedCount();
  return (
    <Link
      {...props}
      onClick={(event) => {
        const lost = unsaved > 1 ? `${unsaved} modifications non enregistrées seront perdues` : '1 modification non enregistrée sera perdue';
        if (unsaved > 0 && !window.confirm(`${lost}. Quitter cette page ?`)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
