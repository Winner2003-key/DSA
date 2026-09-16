import { useEffect, useState } from 'react';
import { stripAccents } from '@dsa/core';

import { getGameService, GRAPH_SLUG } from '@/services';
import type { GameService } from '@/services/game-service';

/** `dsa_list_names` is a flat list with no structure, so it is safe to cache. */
let cache: { slug: string; names: string[] } | null = null;

export function useNames(
  graphSlug: string = GRAPH_SLUG,
  service: GameService = getGameService(),
): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>(cache?.slug === graphSlug ? cache.names : []);
  const [loading, setLoading] = useState(cache?.slug !== graphSlug);

  useEffect(() => {
    if (cache?.slug === graphSlug) {
      setNames(cache.names);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    service
      .listNames(graphSlug)
      .then((value) => {
        cache = { slug: graphSlug, names: value };
        if (!cancelled) setNames(value);
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [graphSlug, service]);

  return { names, loading };
}

function searchKey(value: string): string {
  return stripAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Accent-insensitive autocomplete: "cain" finds CAÏN, "jesus christ" finds
 * JESUS-CHRIST. Names starting with the query come first.
 */
export function searchNames(names: string[], query: string, limit = 8): string[] {
  const key = searchKey(query);
  if (key === '') return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const candidate = searchKey(name);
    if (candidate.startsWith(key)) starts.push(name);
    else if (candidate.includes(key)) contains.push(name);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export function clearNameCacheForTests(): void {
  cache = null;
}
