// The clock of a timed game (GRAPH_SPECIFICATION.md §9), as pure functions over
// ISO instants. SQL mirror: dsa_start_play, dsa_end_thinking and dsa_tick.
//
// The rules it encodes, all of them the owner's decisions:
//   * the thinking time starts when the Tireur gets the card — in a room, the
//     moment both players are there;
//   * it ends at its deadline or at "Je suis prêt", whichever comes first;
//   * the game time starts at the end of the thinking time and is then FIXED:
//     rewinds, going back and wrong name calls all spend the same seconds;
//   * a new card gives a fresh thinking time, and never more game time.

export type GamePhase = 'THINKING' | 'PLAYING';

export interface ClockSettings {
  timed: boolean;
  /** Copied from `app_settings` when the game is created, so it never moves. */
  thinkSeconds: number;
  playSeconds: number;
}

export interface ClockState {
  /** When the preparation phase ended; null while the Tireur still has the card. */
  readyAt: string | null;
  /** The thinking deadline, or (once the phase is over) when it actually ended. */
  thinkEndsAt: string | null;
  /** Fixed when the thinking ends, and never changed afterwards. */
  playEndsAt: string | null;
}

export const NO_CLOCK: ClockState = { readyAt: null, thinkEndsAt: null, playEndsAt: null };

export const DEFAULT_CLOCK_SETTINGS: ClockSettings = { timed: false, thinkSeconds: 40, playSeconds: 120 };

function plus(at: string, seconds: number): string {
  return new Date(Date.parse(at) + seconds * 1000).toISOString();
}

/** True once `now` has reached `deadline`, which is how the server decides it. */
export function reached(deadline: string | null, now: string): boolean {
  return deadline !== null && Date.parse(now) >= Date.parse(deadline);
}

/** Milliseconds left before a deadline, floored at 0; null when there is none. */
export function timeLeftMs(deadline: string | null, now: string): number | null {
  if (deadline === null) return null;
  return Math.max(0, Date.parse(deadline) - Date.parse(now));
}

export function phaseOf(clock: ClockState): GamePhase {
  return clock.readyAt === null ? 'THINKING' : 'PLAYING';
}

/** The game begins: the preparation phase starts, unless the Tireur is an AI. */
export function startPlay(settings: ClockSettings, now: string, tireurIsReady: boolean): ClockState {
  if (!settings.timed) return { readyAt: tireurIsReady ? now : null, thinkEndsAt: null, playEndsAt: null };
  if (tireurIsReady) return { readyAt: now, thinkEndsAt: null, playEndsAt: plus(now, settings.playSeconds) };
  return { readyAt: null, thinkEndsAt: plus(now, settings.thinkSeconds), playEndsAt: null };
}

/** "Je suis prêt", or the thinking deadline: the game time starts from `at`. */
export function endThinking(clock: ClockState, settings: ClockSettings, at: string): ClockState {
  if (clock.readyAt !== null) return clock;
  return {
    readyAt: at,
    thinkEndsAt: clock.thinkEndsAt === null ? null : at,
    playEndsAt: settings.timed ? plus(at, settings.playSeconds) : clock.playEndsAt,
  };
}

/** A new card: a fresh thinking time, and nothing else. */
export function restartThinking(clock: ClockState, settings: ClockSettings, now: string): ClockState {
  if (!settings.timed || clock.readyAt !== null) return clock;
  return { ...clock, thinkEndsAt: plus(now, settings.thinkSeconds) };
}

/**
 * Applies the clock at `now`, exactly as `dsa_tick` does: the thinking phase
 * ends at its own deadline (so the game time is the same length however long the
 * Tireur took), and then the game may be out of time.
 */
export function tick(
  clock: ClockState,
  settings: ClockSettings,
  now: string,
): { clock: ClockState; timeUp: boolean; endedAt: string | null } {
  if (!settings.timed) return { clock, timeUp: false, endedAt: null };

  let next = clock;
  if (next.readyAt === null && reached(next.thinkEndsAt, now)) {
    next = endThinking(next, settings, next.thinkEndsAt as string);
  }
  if (reached(next.playEndsAt, now)) {
    return { clock: next, timeUp: true, endedAt: next.playEndsAt };
  }
  return { clock: next, timeUp: false, endedAt: null };
}

/** The deadline a countdown should show, or null when no clock is running. */
export function activeDeadline(clock: ClockState, settings: ClockSettings): string | null {
  if (!settings.timed) return null;
  return clock.readyAt === null ? clock.thinkEndsAt : clock.playEndsAt;
}
