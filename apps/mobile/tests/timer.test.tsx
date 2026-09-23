/**
 * The optional chronometer (GRAPH_SPECIFICATION §9), on a fake clock so the test
 * can stand at any second of a game. The offline service is the real mirror of
 * the server, so what is checked here is the rule, not a mock's opinion:
 *
 *   * the countdown is computed from `server_now`, never from the device clock;
 *   * the thinking time ends at "Je suis prêt" or at its deadline, and the game
 *     time then runs for its full length and never moves again;
 *   * time up ends the game with no winner, in every mode;
 *   * an untimed game shows no clock at all.
 */
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

import { CountdownRing } from '@/components';
import { OfflineGameService } from '@/services/offline-game-service';
import { levelFor, msLeftOf, useCountdown } from '@/state/use-countdown';
import { useGame } from '@/state/use-game';

import { at, Providers, renderWithProviders, T0 } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';

/** A clock the test moves by hand, shared by the service and by `useCountdown`. */
function fakeClock(start = T0) {
  let ms = Date.parse(start);
  return {
    iso: () => new Date(ms).toISOString(),
    ms: () => ms,
    advance: (seconds: number) => {
      ms += seconds * 1000;
    },
  };
}

function timedService(clock: ReturnType<typeof fakeClock>, secretNodeKey = CAIN) {
  return new OfflineGameService({ persist: false, secretNodeKey, now: clock.iso });
}

const wrapper = ({ children }: { children: React.ReactNode }) => <Providers>{children}</Providers>;

describe('the countdown reads the server clock, not the phone', () => {
  it('measures the time left from server_now plus how long ago the state arrived', () => {
    // This phone's clock is two days fast, and it changes nothing.
    const deviceNow = Date.parse('2026-09-19T08:00:00.000Z');
    const input = { deadline: at(40), serverNow: T0, receivedAt: deviceNow };
    expect(msLeftOf(input, deviceNow)).toBe(40_000);
    expect(msLeftOf(input, deviceNow + 12_000)).toBe(12_000 > 0 ? 28_000 : 40_000);
    expect(msLeftOf(input, deviceNow + 60_000)).toBe(0);
  });

  it('never goes below zero, and reports no clock when there is no deadline', () => {
    expect(msLeftOf({ deadline: null, serverNow: T0, receivedAt: 0 }, 0)).toBe(0);
    expect(msLeftOf({ deadline: at(10), serverNow: T0, receivedAt: 0 }, 999_999)).toBe(0);
  });

  it('warns at 30 s, then at 10 s, then calls time', () => {
    expect(levelFor(31)).toBe('CALM');
    expect(levelFor(30)).toBe('WARNING');
    expect(levelFor(11)).toBe('WARNING');
    expect(levelFor(10)).toBe('LAST_CALL');
    expect(levelFor(1)).toBe('LAST_CALL');
    expect(levelFor(0)).toBe('UP');
  });

  it('counts down on its own and fires onExpire exactly once', async () => {
    jest.useFakeTimers();
    try {
      const clock = fakeClock();
      const onExpire = jest.fn();
      // `receivedAt` pairs with `serverNow`: it is when THAT state arrived, and
      // it only moves when a new one does.
      const receivedAt = clock.ms();
      const { result } = await renderHook(() =>
        useCountdown({ deadline: at(12), serverNow: T0, receivedAt, totalSeconds: 40, onExpire, now: clock.ms }),
      );
      expect(result.current.secondsLeft).toBe(12);
      expect(result.current.level).toBe('WARNING');

      await act(async () => {
        clock.advance(6);
        jest.advanceTimersByTime(6000);
      });
      expect(result.current.secondsLeft).toBe(6);
      expect(result.current.level).toBe('LAST_CALL');
      expect(onExpire).not.toHaveBeenCalled();

      await act(async () => {
        clock.advance(10);
        jest.advanceTimersByTime(10_000);
      });
      expect(result.current.secondsLeft).toBe(0);
      expect(result.current.level).toBe('UP');
      expect(onExpire).toHaveBeenCalledTimes(1);

      // Still ticking, but the game is only ended once.
      await act(async () => {
        clock.advance(5);
        jest.advanceTimersByTime(5000);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      // Unmount while the timers are still fake: a running interval must not
      // outlive this test and disturb the next one.
      cleanup();
      jest.useRealTimers();
    }
  });
});

describe('a timed game, from the card to the deadline', () => {
  it('starts the thinking time at creation and the game time at "Je suis prêt"', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });

    let state = await service.getState(sessionId);
    expect(state.timed).toBe(true);
    expect(state.phase).toBe('THINKING');
    expect(state.think_ends_at).toBe(at(40));
    expect(state.play_ends_at).toBeNull();
    expect(state.settings).toMatchObject({ timed: true, think_seconds: 40, play_seconds: 120, max_redraws: 2 });

    clock.advance(12);
    state = await service.tireurReady(sessionId);
    expect(state.phase).toBe('PLAYING');
    expect(state.play_ends_at).toBe(at(12 + 120));
  });

  it('ends the thinking at its own deadline, so the game time is never shortened', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });

    // Nobody touched the phone for a minute and a half.
    clock.advance(95);
    const state = await service.checkTime(sessionId);
    expect(state.phase).toBe('PLAYING');
    expect(state.tireur_ready).toBe(true);
    // The thinking ended at 40 s, so the players still get their whole 120 s.
    expect(state.play_ends_at).toBe(at(160));
  });

  it('keeps the game deadline whatever the players do with their time', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });
    const deadline = (await service.tireurReady(sessionId)).play_ends_at;
    expect(deadline).toBe(at(120));

    // A question, a rewind, a refused name: the same 120 s pays for all of it.
    clock.advance(5);
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    clock.advance(5);
    await service.rewind(sessionId, 1);
    clock.advance(5);
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    await service.guess(sessionId, 'ABEL');
    await service.confirmGuess(sessionId, 'NON');

    expect((await service.getState(sessionId)).play_ends_at).toBe(deadline);
  });

  it('ends the game with no winner once the time is up, and still teaches the name', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });
    await service.tireurReady(sessionId);
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');

    clock.advance(121);
    const state = await service.checkTime(sessionId);
    expect(state.status).toBe('TIME_UP');
    expect(state.prompt).toBeNull();

    // Every move is refused from then on, whoever makes it.
    await expect(service.ask(sessionId)).rejects.toMatchObject({ code: 'TIME_UP' });
    await expect(service.answer(sessionId, 'OUI')).rejects.toMatchObject({ code: 'TIME_UP' });
    await expect(service.guess(sessionId, 'CAÏN')).rejects.toMatchObject({ code: 'TIME_UP' });
    await expect(service.rewind(sessionId, 1)).rejects.toMatchObject({ code: 'TIME_UP' });
    await expect(service.goBack(sessionId, 0)).rejects.toMatchObject({ code: 'TIME_UP' });
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'TIME_UP' });

    const reveal = await service.getRevealedPath(sessionId);
    expect(reveal.status).toBe('TIME_UP');
    expect(reveal.winner).toBeNull();
    expect(reveal.secret?.name).toBe('CAÏN');
    expect(reveal.stats).toMatchObject({ timed: true, play_seconds: 120, found_in_seconds: null });
    // The book's path is what the end screen shows, and it is there.
    expect((await service.getSolutionPath(sessionId)).path.length).toBeGreaterThan(0);
  });

  it('gives the AI Tireur no thinking time: the game clock starts at once', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR', settings: { timed: true } });
    const state = await service.getState(sessionId);
    expect(state.phase).toBe('PLAYING');
    expect(state.tireur_ready).toBe(true);
    expect(state.think_ends_at).toBeNull();
    expect(state.play_ends_at).toBe(at(120));
  });

  it('calls time on an AI Découvreur game too', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'AI_DECOUVREUR', settings: { timed: true } });
    await service.tireurReady(sessionId);
    clock.advance(200);
    await expect(service.aiDecouvreurStep(sessionId)).rejects.toMatchObject({ code: 'TIME_UP' });
    expect((await service.getState(sessionId)).status).toBe('TIME_UP');
  });

  it('records how long the winners took, out of how long they had', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });
    await service.tireurReady(sessionId);
    clock.advance(72);
    await service.guess(sessionId, 'CAÏN');
    await service.confirmGuess(sessionId, 'OUI');

    const reveal = await service.getRevealedPath(sessionId);
    expect(reveal.status).toBe('DISCOVERED');
    expect(reveal.stats).toMatchObject({ timed: true, play_seconds: 120, found_in_seconds: 72 });
  });

  it('takes the durations the admin has set, and keeps them for a running game', async () => {
    const clock = fakeClock();
    const service = new OfflineGameService({
      persist: false,
      secretNodeKey: CAIN,
      now: clock.iso,
      appSettings: { thinkSeconds: 90, playSeconds: 300 },
    });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });
    expect((await service.getState(sessionId)).think_ends_at).toBe(at(90));
    expect((await service.tireurReady(sessionId)).play_ends_at).toBe(at(300));
  });
});

describe('an untimed game is exactly as it was', () => {
  it('runs no clock, and nothing ever times out', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    let state = await service.getState(sessionId);
    expect(state.timed).toBe(false);
    expect(state.think_ends_at).toBeNull();
    expect(state.play_ends_at).toBeNull();

    // Only the preparation phase is new, and it is not a clock.
    expect(state.phase).toBe('THINKING');
    await service.tireurReady(sessionId);
    clock.advance(10_000);
    state = await service.checkTime(sessionId);
    expect(state.status).toBe('PLAYING');
    expect((await service.getRevealedPath(sessionId)).stats).toMatchObject({ timed: false, play_seconds: null });
  });
});

describe('the ring on screen', () => {
  it('shows the time left and its label, and nothing at all without a clock', async () => {
    const running = await renderWithProviders(
      <CountdownRing
        countdown={{ running: true, msLeft: 72_000, secondsLeft: 72, fraction: 0.6, level: 'CALM' }}
        size="lg"
        label="Temps pour trouver"
      />,
    );
    expect(running.getByTestId('countdown-value')).toHaveTextContent('1:12');
    expect(running.getByTestId('countdown-label')).toHaveTextContent('Temps pour trouver');
    expect(running.getByLabelText(/Temps pour trouver : Il reste 1 minute 12 secondes/)).toBeTruthy();

    const stopped = await renderWithProviders(
      <CountdownRing countdown={{ running: false, msLeft: 0, secondsLeft: 0, fraction: 1, level: 'CALM' }} />,
    );
    expect(stopped.queryByTestId('countdown')).toBeNull();
  });
});

describe('useGame and the clock', () => {
  it('shows the thinking countdown, then the game countdown, and ends the game itself', async () => {
    jest.useFakeTimers();
    try {
      const clock = fakeClock();
      const service = timedService(clock);
      const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });
      const { result } = await renderHook(() => useGame(sessionId, { service }), { wrapper });
      await waitFor(() => expect(result.current.state).not.toBeNull());

      expect(result.current.phase).toBe('TIREUR_READY');
      expect(result.current.clockPhase).toBe('THINKING');
      expect(result.current.countdown.running).toBe(true);
      expect(result.current.countdown.secondsLeft).toBe(40);

      await act(async () => {
        clock.advance(10);
        await result.current.confirmTireurReady();
      });
      await waitFor(() => expect(result.current.phase).toBe('PLAYING'));
      expect(result.current.clockPhase).toBe('PLAYING');
      expect(result.current.countdown.secondsLeft).toBe(120);

      // Nobody plays; the countdown reaches zero and tells the server by itself.
      await act(async () => {
        clock.advance(121);
        jest.advanceTimersByTime(121_000);
      });
      await waitFor(() => expect(result.current.state?.status).toBe('TIME_UP'));
      expect(result.current.phase).toBe('ENDED');
    } finally {
      cleanup();
      jest.useRealTimers();
    }
  });

  it('runs no countdown in an untimed game', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    const { result } = await renderHook(() => useGame(sessionId, { service }), { wrapper });
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(result.current.countdown.running).toBe(false);
  });
});

describe('the AI Découvreur waits for the Tireur', () => {
  it('never plays during the preparation phase, and starts once the Tireur is ready', async () => {
    const clock = fakeClock();
    const service = timedService(clock);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'AI_DECOUVREUR', settings: { timed: true } });
    const step = jest.spyOn(service, 'aiDecouvreurStep');

    const { result } = await renderHook(() => useGame(sessionId, { service, aiThinkingMs: 0 }), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe('TIREUR_READY'));
    // Before the fix the hook retried every refused step, so busy flickered and
    // the Tireur's own taps were dropped while a step was in flight.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(step).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.aiThinking).toBe(false);

    await act(async () => {
      result.current.confirmTireurReady();
    });
    await waitFor(() => expect(result.current.phase).toBe('PLAYING'));
    expect(result.current.clockPhase).toBe('PLAYING');
    await waitFor(() => expect(step).toHaveBeenCalled());
  });
});
