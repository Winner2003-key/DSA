/**
 * The countdown of a timed game (GRAPH_SPECIFICATION §9).
 *
 * The server is the only authority on time, so nothing here reads the device
 * clock as if it were right: every state carries `server_now`, and the phone
 * only measures how long ago it received it. A phone whose clock is days off, or
 * that has just woken up from the background, therefore still shows the right
 * seconds as soon as one state arrives.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { warningFeedback } from '@/lib/haptics';

/** How often the countdown re-renders. Fine for a ring and cheap enough. */
export const COUNTDOWN_TICK_MS = 250;

/** The two moments the players are warned, in seconds left. */
export const WARN_AT_SECONDS = 30;
export const LAST_CALL_AT_SECONDS = 10;

export type CountdownLevel = 'CALM' | 'WARNING' | 'LAST_CALL' | 'UP';

export interface CountdownInput {
  /** The deadline the server gave, or null when no clock is running. */
  deadline: string | null;
  /** The server's own clock when it sent that deadline. */
  serverNow: string;
  /** `Date.now()` when this device received it. */
  receivedAt: number;
  /** The whole length of this phase, for the ring's sweep. */
  totalSeconds: number | null;
  /** Called once, when the countdown reaches zero. */
  onExpire?: () => void;
  /** Injected in tests. */
  now?: () => number;
}

export interface Countdown {
  running: boolean;
  msLeft: number;
  /** What the player reads: never shows 0 while a fraction of a second is left. */
  secondsLeft: number;
  /** 1 at the start of the phase, 0 at the deadline. */
  fraction: number;
  level: CountdownLevel;
}

export function levelFor(secondsLeft: number): CountdownLevel {
  if (secondsLeft <= 0) return 'UP';
  if (secondsLeft <= LAST_CALL_AT_SECONDS) return 'LAST_CALL';
  if (secondsLeft <= WARN_AT_SECONDS) return 'WARNING';
  return 'CALM';
}

/**
 * Milliseconds left, measured against the server's clock: the device only
 * contributes how much time has passed since the state arrived.
 */
export function msLeftOf(input: Pick<CountdownInput, 'deadline' | 'serverNow' | 'receivedAt'>, nowMs: number): number {
  if (input.deadline === null) return 0;
  const elapsed = Math.max(0, nowMs - input.receivedAt);
  const serverTime = Date.parse(input.serverNow) + elapsed;
  return Math.max(0, Date.parse(input.deadline) - serverTime);
}

const STOPPED: Countdown = { running: false, msLeft: 0, secondsLeft: 0, fraction: 1, level: 'CALM' };

/** Read through `latest` on every tick, never captured: a captured `Date.now`
 *  would keep pointing at the real clock when a test replaces the global one. */
function nowOf(input: CountdownInput): number {
  return input.now ? input.now() : Date.now();
}

export function useCountdown(input: CountdownInput): Countdown {
  const { deadline, serverNow, receivedAt, totalSeconds } = input;
  const [msLeft, setMsLeft] = useState(() => (deadline === null ? 0 : msLeftOf(input, nowOf(input))));

  const latest = useRef(input);
  latest.current = input;
  /** Warnings and the expiry fire once per deadline, not once per tick. */
  const announced = useRef<{ deadline: string | null; warned: boolean; lastCall: boolean; expired: boolean }>({
    deadline: null,
    warned: false,
    lastCall: false,
    expired: false,
  });

  useEffect(() => {
    if (deadline === null) {
      setMsLeft(0);
      return;
    }
    if (announced.current.deadline !== deadline) {
      announced.current = { deadline, warned: false, lastCall: false, expired: false };
    }

    const step = () => {
      const left = msLeftOf(latest.current, nowOf(latest.current));
      setMsLeft(left);
      const seconds = Math.ceil(left / 1000);
      const state = announced.current;
      if (!state.warned && seconds <= WARN_AT_SECONDS) {
        state.warned = true;
        // Subtle: a short buzz, never a sound — people are talking around the phone.
        if (seconds > LAST_CALL_AT_SECONDS) warningFeedback();
      }
      if (!state.lastCall && seconds <= LAST_CALL_AT_SECONDS) {
        state.lastCall = true;
        warningFeedback();
      }
      if (!state.expired && left <= 0) {
        state.expired = true;
        latest.current.onExpire?.();
      }
    };

    step();
    const timer = setInterval(step, COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
    // `serverNow` and `receivedAt` change on every refresh: resynchronize then.
  }, [deadline, receivedAt, serverNow]);

  return useMemo(() => {
    if (deadline === null) return STOPPED;
    const totalMs = (totalSeconds ?? 0) * 1000;
    return {
      running: true,
      msLeft,
      secondsLeft: Math.ceil(msLeft / 1000),
      fraction: totalMs > 0 ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0,
      level: levelFor(Math.ceil(msLeft / 1000)),
    };
  }, [deadline, msLeft, totalSeconds]);
}
