import { useCallback, useEffect, useState } from 'react';

import { getGameService, GRAPH_SLUG } from '@/services';
import { toDsaError, type DsaError } from '@/services/errors';
import type { GameService } from '@/services/game-service';
import type { Secret } from '@/services/types';

/**
 * The Tireur's card. `enabled` must be false on any Découvreur screen: this is the
 * one call that can reveal the secret, and it is the Tireur's alone
 * (DATABASE_SCHEMA.md §5).
 *
 * `reload` is for "Changer de nom" (§9): the card is the one thing the state JSON
 * never carries, so a redraw has to ask for it again.
 */
export function useSecret(
  sessionId: string | null,
  enabled: boolean,
  service: GameService = getGameService(),
): { secret: Secret | null; error: DsaError | null; reload: () => Promise<void> } {
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<DsaError | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) {
      setSecret(null);
      return;
    }
    let cancelled = false;
    service
      .getMySecret(sessionId)
      .then((value) => {
        if (!cancelled) {
          setSecret(value);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toDsaError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, service, sessionId]);

  const reload = useCallback(async () => {
    if (!sessionId || !enabled) return;
    try {
      setSecret(await service.getMySecret(sessionId));
      setError(null);
    } catch (caught) {
      setError(toDsaError(caught));
    }
  }, [enabled, service, sessionId]);

  return { secret, error, reload };
}

export { GRAPH_SLUG };
