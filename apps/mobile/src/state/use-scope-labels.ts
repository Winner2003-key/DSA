import { useEffect, useState } from 'react';

import { scopeTitles } from '@/components/scope-picker';
import { GRAPH_SLUG, getGameService, isPlayable } from '@/services';
import type { BookSection } from '@/services/types';

/**
 * The sommaire, read at most once per run of the app. Only a game played on a
 * part of the book needs it, and both phones of a room need it even though only
 * one of them opened the picker.
 */
let cached: BookSection[] | null = null;
let reading: Promise<BookSection[]> | null = null;

/** Forgets the sommaire. Tests call it; the app never does. */
export function resetScopeLabelsCache(): void {
  cached = null;
  reading = null;
}

/**
 * How to name the part of the book a game is played on: « Ancien Testament »,
 * « Hommes », « LES EVANGILES » — the words of the picker, not the labels of the
 * nodes behind them (the Ancien Testament is the node the book calls « HOMME »).
 *
 * `fallback` is what the server sent (`state.scope_labels`); it is what shows
 * until the sommaire is read, and for ever if it cannot be.
 */
export function useScopeLabels(scope: readonly string[], fallback: readonly string[]): string[] {
  const [sections, setSections] = useState<BookSection[] | null>(cached);

  useEffect(() => {
    if (scope.length === 0 || sections !== null || !isPlayable()) return;
    let cancelled = false;
    reading ??= getGameService()
      .listSections(GRAPH_SLUG)
      .then((rows) => {
        cached = rows;
        return rows;
      })
      .catch(() => {
        reading = null;
        return [];
      });
    void reading.then((rows) => {
      if (!cancelled && rows.length > 0) setSections(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [scope.length, sections]);

  if (scope.length === 0) return [];
  if (!sections) return [...fallback];
  const named = scopeTitles(sections, scope);
  return named.length > 0 ? named : [...fallback];
}
