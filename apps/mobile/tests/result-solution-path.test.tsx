/**
 * The end of every game (GRAPH_SPECIFICATION §9, GAME_RULES point 5): the game
 * card first — outcome, name, statistics and, for a timed game that was won, how
 * long it took — and then the book's own path to that name, whatever happened.
 *
 * The players' own path is no longer on this screen; it stays behind "Voir le
 * chemin" during play.
 */
import React from 'react';

import { ResultHeader } from '@/components';
import { OfflineGameService } from '@/services/offline-game-service';
import type { RevealedPath } from '@/services/types';

import { makeStats, renderWithProviders, T0 } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';

const reveal = (over: Partial<RevealedPath> = {}): RevealedPath => ({
  status: 'DISCOVERED',
  winner: 'DECOUVREUR',
  path: [],
  stats: makeStats({ questions: 7, non: 1 }),
  secret: { node_id: 'n-cain', name: 'CAÏN', description: 'Le meurtrier · LIE A ADAM', has_homonyms: false },
  ...over,
});

describe('the game card', () => {
  it('says how the game ended, in its own words', async () => {
    const found = await renderWithProviders(<ResultHeader reveal={reveal()} />);
    expect(found.getByTestId('result-title')).toHaveTextContent(/Trouvé !/);

    const stopped = await renderWithProviders(<ResultHeader reveal={reveal({ status: 'ABANDONED', winner: null })} />);
    expect(stopped.getByTestId('result-title')).toHaveTextContent('Partie arrêtée');

    const timeUp = await renderWithProviders(<ResultHeader reveal={reveal({ status: 'TIME_UP', winner: null })} />);
    expect(timeUp.getByTestId('result-title')).toHaveTextContent(/Temps écoulé/);
    expect(timeUp.getByTestId('result-time-up-hint')).toBeTruthy();
    // The name is taught even when nobody found it.
    expect(timeUp.getByTestId('result-name')).toHaveTextContent('CAÏN');
  });

  it('writes "Trouvé en X sur Y" when the chronometer was on and the name was found', async () => {
    const screen = await renderWithProviders(
      <ResultHeader reveal={reveal({ stats: makeStats({ questions: 7, non: 1, timed: true, play_seconds: 120, found_in_seconds: 72 }) })} />,
    );
    expect(screen.getByTestId('result-found-in')).toHaveTextContent('Trouvé en 1 min 12 s sur 2 min');
  });

  it('writes it in whole minutes and bare seconds too', async () => {
    const round = await renderWithProviders(
      <ResultHeader reveal={reveal({ stats: makeStats({ timed: true, play_seconds: 120, found_in_seconds: 60 }) })} />,
    );
    expect(round.getByTestId('result-found-in')).toHaveTextContent('Trouvé en 1 min sur 2 min');

    const quick = await renderWithProviders(
      <ResultHeader reveal={reveal({ stats: makeStats({ timed: true, play_seconds: 120, found_in_seconds: 8 }) })} />,
    );
    expect(quick.getByTestId('result-found-in')).toHaveTextContent('Trouvé en 8 s sur 2 min');
  });

  it('writes nothing about time when there was no chronometer, or nothing was found', async () => {
    const untimed = await renderWithProviders(
      <ResultHeader reveal={reveal({ stats: makeStats({ questions: 7, found_in_seconds: 40 }) })} />,
    );
    expect(untimed.queryByTestId('result-found-in')).toBeNull();

    const lost = await renderWithProviders(
      <ResultHeader
        reveal={reveal({ status: 'TIME_UP', winner: null, stats: makeStats({ timed: true, play_seconds: 120 }) })}
      />,
    );
    expect(lost.queryByTestId('result-found-in')).toBeNull();
  });

  it('still prints the server statistics', async () => {
    const screen = await renderWithProviders(
      <ResultHeader reveal={reveal({ stats: makeStats({ questions: 8, non: 2, backs: 1, rewinds: 1 }) })} />,
    );
    expect(screen.getByTestId('result-stats')).toHaveTextContent(/8 questions.*2 non.*2 retours/);
  });
});

describe('the book’s path, at the end of every game', () => {
  const play = async (outcome: 'DISCOVERED' | 'ABANDONED' | 'TIME_UP') => {
    let ms = Date.parse(T0);
    const service = new OfflineGameService({
      persist: false,
      secretNodeKey: CAIN,
      now: () => new Date(ms).toISOString(),
    });
    const { sessionId } = await service.createSession({
      graphSlug: 'mini',
      mode: 'LOCAL',
      settings: { timed: outcome === 'TIME_UP' },
    });
    await service.tireurReady(sessionId);
    // The players wander off the book's way before the game ends.
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    await service.guess(sessionId, 'ABEL');
    await service.confirmGuess(sessionId, 'NON');

    if (outcome === 'DISCOVERED') {
      await service.guess(sessionId, 'CAÏN');
      await service.confirmGuess(sessionId, 'OUI');
    } else if (outcome === 'ABANDONED') {
      await service.abandon(sessionId);
    } else {
      ms += 200_000;
      await service.checkTime(sessionId);
    }
    return { service, sessionId };
  };

  it.each(['DISCOVERED', 'ABANDONED', 'TIME_UP'] as const)('is the same book path after %s', async (outcome) => {
    const { service, sessionId } = await play(outcome);
    const solution = await service.getSolutionPath(sessionId);
    expect(solution.status).toBe(outcome);
    expect(solution.secret?.name).toBe('CAÏN');
    expect(solution.path.map((entry) => `${entry.text}=${entry.answer_label}`)).toEqual([
      'ANCIEN=OUI',
      'HOMME=OUI',
      'PENTATEUQUE=OUI',
      'LIE A ADAM=OUI',
      'CLASSE 1=OUI',
      'Premier homme=NON',
      'Le meurtrier=OUI',
    ]);
  });

  it('is the book’s way, not the players’ — no detour and no refused name', async () => {
    const { service, sessionId } = await play('ABANDONED');
    const played = (await service.getRevealedPath(sessionId)).path;
    const book = (await service.getSolutionPath(sessionId)).path;
    // The players stopped after two questions; the book goes all the way.
    expect(played).toHaveLength(2);
    expect(book).toHaveLength(7);
    // And it carries the very fields PathGraph already draws.
    for (const entry of book) {
      expect(Object.keys(entry).sort()).toEqual(
        ['answer_label', 'node_id', 'node_type', 'prompt_kind', 'step_index', 'target_text', 'text'].sort(),
      );
      expect(entry.target_text !== null).toBe(entry.prompt_kind === 'SPINE');
    }
  });

  it('is refused while the game is still being played', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    await expect(service.getSolutionPath(sessionId)).rejects.toMatchObject({ code: 'GAME_NOT_OVER' });
    await service.tireurReady(sessionId);
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    await expect(service.getSolutionPath(sessionId)).rejects.toMatchObject({ code: 'GAME_NOT_OVER' });
  });
});
