/**
 * What a call may promise before a game starts (`dsa_call_allowance`): the
 * minutes this player has left today, the daily allowance, the longest a call may
 * last, and whether the app's monthly budget still allows new calls.
 *
 * Read where a game is about to start — "Préparer la partie" and the lobby — so
 * the numbers on screen are always the admin's current Réglages and never
 * hard-coded (GAME_RULES "Call limits"). Null while it is being read, or when
 * there is nothing to ask about.
 */
import { useEffect, useState } from 'react';

import { getGameService, isPlayable } from '@/services';
import type { CallAllowance } from '@/services/types';

export function useCallAllowance(enabled = true): CallAllowance | null {
  const [allowance, setAllowance] = useState<CallAllowance | null>(null);

  useEffect(() => {
    if (!enabled || !isPlayable()) {
      setAllowance(null);
      return;
    }
    let cancelled = false;
    void getGameService()
      .getCallAllowance()
      .then((next) => {
        if (!cancelled) setAllowance(next);
      })
      // getCallAllowance already answers "no calls" for a server without 0011;
      // anything else left over must not take the screen down.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return allowance;
}
