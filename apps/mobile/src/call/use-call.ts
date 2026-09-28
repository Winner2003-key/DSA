/**
 * One call, for the length of one game. It connects when the call has started on
 * the server (`call_ends_at` is set) and hangs up at the first of: the end of the
 * game, the call's own deadline, or leaving the screen.
 *
 * The hook never ends a game by itself except by telling the server the time is
 * up (`checkTime`, exactly as the countdown of a timed game does, §9). The server
 * decides; the other phone learns it over Realtime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createCall } from './call';
import { fetchCallToken } from './token';
import { CallError, IDLE_SNAPSHOT, type CallSnapshot } from './types';

/** The two warnings before the end of a call (GAME_RULES "Call limits"). */
export const CALL_WARNING_SECONDS = [60, 30] as const;

export interface UseCall extends CallSnapshot {
  /** Seconds left on the call, or null when there is no call clock yet. */
  secondsLeft: number | null;
  /** The warning to show now: 60, 30 or null. */
  warning: number | null;
  toggleMute: () => void;
  /** After « L'appel a échoué », try the whole thing again. */
  retry: () => void;
}

export interface UseCallOptions {
  /** Null while there is nothing to join (no call, or the game is over). */
  sessionId: string | null;
  /** `state.call_ends_at`: set by the server when the call opened. */
  endsAt: string | null;
  /** The server's clock and when it arrived, so the seconds are never the device's. */
  serverNow: string | null;
  receivedAt: number;
  /** False as soon as the game is over: the call must not reconnect. */
  active: boolean;
  /** Told once, at `endsAt`, so the server turns the game into TIME_UP. */
  onTimeUp: () => void;
  /** Injected in tests. */
  create?: typeof createCall;
  getToken?: typeof fetchCallToken;
}

export function useCall(options: UseCallOptions): UseCall {
  const { sessionId, endsAt, serverNow, receivedAt, active, onTimeUp } = options;
  const create = options.create ?? createCall;
  const getToken = options.getToken ?? fetchCallToken;

  const call = useMemo(() => create(), [create]);
  const [snapshot, setSnapshot] = useState<CallSnapshot>(() => call.snapshot());
  const [attempt, setAttempt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const mounted = useRef(true);
  const timeUpSent = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => call.onChange((next) => {
    if (mounted.current) setSnapshot(next);
  }), [call]);

  // Connect once per game (or per retry), and hang up on the way out.
  useEffect(() => {
    if (!sessionId || !active || endsAt === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const token = await getToken(sessionId);
        if (cancelled) return;
        await call.connect(token);
      } catch (caught) {
        if (cancelled || !mounted.current) return;
        const failure = caught instanceof CallError ? caught : new CallError('CONNECT_FAILED');
        setSnapshot((current) => ({ ...current, state: 'failed', error: failure }));
      }
    })();

    return () => {
      cancelled = true;
      void call.disconnect();
    };
  }, [active, attempt, call, endsAt, getToken, sessionId]);

  // The call's own countdown, measured against the server's clock.
  useEffect(() => {
    if (endsAt === null) {
      setSecondsLeft(null);
      return;
    }
    const end = Date.parse(endsAt);
    const base = serverNow === null ? receivedAt : Date.parse(serverNow);
    if (!Number.isFinite(end) || !Number.isFinite(base)) {
      setSecondsLeft(null);
      return;
    }
    const left = () => Math.max(0, Math.round((end - (base + (Date.now() - receivedAt))) / 1000));

    setSecondsLeft(left());
    const timer = setInterval(() => {
      const next = left();
      setSecondsLeft(next);
      // At the deadline: hang up here, and let the server end the game.
      if (next <= 0 && !timeUpSent.current) {
        timeUpSent.current = true;
        void call.disconnect();
        onTimeUp();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [call, endsAt, onTimeUp, receivedAt, serverNow]);

  useEffect(() => {
    timeUpSent.current = false;
  }, [endsAt]);

  const warning = useMemo(() => {
    if (secondsLeft === null || snapshot.state === 'idle') return null;
    return CALL_WARNING_SECONDS.find((mark) => secondsLeft <= mark && secondsLeft > mark - 10) ?? null;
  }, [secondsLeft, snapshot.state]);

  const toggleMute = useCallback(() => {
    void call.setMuted(!call.snapshot().muted);
  }, [call]);

  const retry = useCallback(() => {
    setSnapshot((current) => ({ ...current, state: 'connecting', error: null }));
    setAttempt((n) => n + 1);
  }, []);

  return {
    ...(sessionId && endsAt !== null ? snapshot : IDLE_SNAPSHOT),
    secondsLeft,
    warning,
    toggleMute,
    retry,
  };
}
