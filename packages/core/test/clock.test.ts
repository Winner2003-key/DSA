// GRAPH_SPECIFICATION.md §9: the clock of a timed game. Mirror of dsa_tick.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLOCK_SETTINGS,
  NO_CLOCK,
  activeDeadline,
  endThinking,
  phaseOf,
  reached,
  restartThinking,
  startPlay,
  tick,
  timeLeftMs,
} from '../src/index';
import type { ClockSettings } from '../src/index';

const TIMED: ClockSettings = { timed: true, thinkSeconds: 40, playSeconds: 120 };
const UNTIMED: ClockSettings = { ...DEFAULT_CLOCK_SETTINGS };

const T0 = '2026-09-17T12:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

describe('the clock of a timed game', () => {
  it('starts the thinking time when the game begins', () => {
    const clock = startPlay(TIMED, T0, false);
    expect(clock).toEqual({ readyAt: null, thinkEndsAt: at(40), playEndsAt: null });
    expect(phaseOf(clock)).toBe('THINKING');
    expect(activeDeadline(clock, TIMED)).toBe(at(40));
  });

  it('gives the AI Tireur no thinking time: the game time starts at once', () => {
    const clock = startPlay(TIMED, T0, true);
    expect(clock).toEqual({ readyAt: T0, thinkEndsAt: null, playEndsAt: at(120) });
    expect(phaseOf(clock)).toBe('PLAYING');
  });

  it('runs no clock at all in an untimed game', () => {
    const clock = startPlay(UNTIMED, T0, false);
    expect(clock).toEqual({ readyAt: null, thinkEndsAt: null, playEndsAt: null });
    expect(activeDeadline(clock, UNTIMED)).toBeNull();
    expect(tick(clock, UNTIMED, at(100000))).toEqual({ clock, timeUp: false, endedAt: null });
  });

  it('"Je suis prêt" ends the thinking early and starts the game time there', () => {
    const clock = endThinking(startPlay(TIMED, T0, false), TIMED, at(12));
    expect(clock).toEqual({ readyAt: at(12), thinkEndsAt: at(12), playEndsAt: at(132) });
    expect(phaseOf(clock)).toBe('PLAYING');
    expect(activeDeadline(clock, TIMED)).toBe(at(132));
  });

  it('ends the thinking at its own deadline, not at the moment someone looks', () => {
    const started = startPlay(TIMED, T0, false);
    // Nobody touched the game until 95 s in; the thinking still ended at 40 s,
    // so the players get their full 120 s and not a second more.
    const { clock, timeUp } = tick(started, TIMED, at(95));
    expect(clock).toEqual({ readyAt: at(40), thinkEndsAt: at(40), playEndsAt: at(160) });
    expect(timeUp).toBe(false);
  });

  it('calls time once the game deadline is reached, and says when', () => {
    const clock = endThinking(startPlay(TIMED, T0, false), TIMED, T0);
    expect(tick(clock, TIMED, at(119.999)).timeUp).toBe(false);
    const out = tick(clock, TIMED, at(120));
    expect(out.timeUp).toBe(true);
    expect(out.endedAt).toBe(at(120));
    // The deadline itself belongs to the players: a move exactly at 120 s is too late.
    expect(reached(clock.playEndsAt, at(120))).toBe(true);
  });

  it('never moves the game deadline once it is set', () => {
    const clock = endThinking(startPlay(TIMED, T0, false), TIMED, T0);
    // A rewind, going back, a refused name: none of them touch the clock, so
    // there is nothing to call. The deadline is simply still the same object.
    expect(restartThinking(clock, TIMED, at(60))).toEqual(clock);
    expect(endThinking(clock, TIMED, at(60))).toEqual(clock);
    expect(tick(clock, TIMED, at(60)).clock.playEndsAt).toBe(at(120));
  });

  it('gives a new card a fresh thinking time, and no more game time', () => {
    const started = startPlay(TIMED, T0, false);
    const afterRedraw = restartThinking(started, TIMED, at(30));
    expect(afterRedraw).toEqual({ readyAt: null, thinkEndsAt: at(70), playEndsAt: null });
    // and the game time is still the full 120 s, counted from the new thinking end
    expect(endThinking(afterRedraw, TIMED, at(70)).playEndsAt).toBe(at(190));
  });

  it('does not restart the thinking time once the game has started', () => {
    const clock = endThinking(startPlay(TIMED, T0, false), TIMED, at(10));
    expect(restartThinking(clock, TIMED, at(20))).toEqual(clock);
  });

  it('reports the time left against the server clock', () => {
    const clock = startPlay(TIMED, T0, false);
    expect(timeLeftMs(clock.thinkEndsAt, T0)).toBe(40_000);
    expect(timeLeftMs(clock.thinkEndsAt, at(39.5))).toBe(500);
    expect(timeLeftMs(clock.thinkEndsAt, at(60))).toBe(0);
    expect(timeLeftMs(null, T0)).toBeNull();
    expect(reached(null, T0)).toBe(false);
  });

  it('has a no-clock value for untimed games', () => {
    expect(phaseOf(NO_CLOCK)).toBe('THINKING');
    expect(activeDeadline(NO_CLOCK, TIMED)).toBeNull();
  });
});
