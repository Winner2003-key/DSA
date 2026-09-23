/**
 * GAME_RULES "How questions are said" and GRAPH_SPECIFICATION §10: a question is the
 * book label plus "?" — "ANCIEN ?", "Le meurtrier ?" — on screen and when spoken.
 * Never "Est-ce …".
 */
import React from 'react';
import * as Speech from 'expo-speech';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { asQuestion, fr } from '@/i18n/fr';
import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import type { GameState } from '@/services/types';
import { clearNameCacheForTests } from '@/state/use-names';
import { useGame, type UseGame } from '@/state/use-game';
import { DecouvreurView } from '@/views/decouvreur-view';
import { TireurView } from '@/views/tireur-view';

import { Providers, renderWithProviders } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';
const EST_CE = /est[\s-]*ce/i;

/**
 * Every string in fr, with the string builders called on a sample argument.
 * Builders take different shapes (a label, a count, a list of section labels),
 * so each sample is tried until one produces a string.
 */
const SAMPLES: unknown[] = ['LIE A ADAM', 1, ['LIE A ADAM', 'LES EVANGILES']];

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    for (const sample of SAMPLES) {
      try {
        return [String((value as (...args: unknown[]) => string)(sample, sample, sample))];
      } catch {
        // Wrong shape for this builder: try the next sample.
      }
    }
    throw new Error(`no sample argument fits this fr builder: ${String(value)}`);
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

const spoken = () => (Speech.speak as jest.Mock).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  (Speech.speak as jest.Mock).mockClear();
  clearNameCacheForTests();
});
afterEach(() => setGameService(null));

it('has no "Est-ce" in any French string, and phrases questions as the bare label', () => {
  expect(allStrings(fr).filter((s) => EST_CE.test(s))).toEqual([]);
  expect(fr.spoken.question('ANCIEN')).toBe(asQuestion('ANCIEN'));
  expect(asQuestion('Le meurtrier').replace(/\s/g, ' ')).toBe('Le meurtrier ?');
});

it('shows and speaks the Découvreur\'s next question as "LABEL ?"', async () => {
  const offline = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  setGameService(offline);
  const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR' });
  const { result } = await renderHook(() => useGame(sessionId, { service: offline, aiAnswerBeatMs: 0 }), {
    wrapper: Providers,
  });
  await waitFor(() => expect(result.current.state).not.toBeNull());
  await act(async () => {
    await result.current.ask(); // ANCIEN → OUI
  });

  const screen = await renderWithProviders(<DecouvreurView game={result.current} />);
  expect(screen.getByTestId('prompt-text')).toHaveTextContent(/^HOMME\s\?$/);
  expect(JSON.stringify(screen.toJSON())).not.toMatch(EST_CE);

  await waitFor(() => expect(spoken().length).toBeGreaterThan(0));
  // Spoken in its speakable form (§10): the screen keeps the book spelling.
  expect(spoken().some((text) => text.includes('Homme ?'))).toBe(true);
  expect(spoken().filter((text) => EST_CE.test(text))).toEqual([]);
});

it('shows and speaks the Tireur\'s incoming question and name call without "Est-ce"', async () => {
  const offline = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  setGameService(offline);
  const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
  await offline.tireurReady(sessionId);
  await offline.ask(sessionId);
  const { result } = await renderHook(() => useGame(sessionId, { service: offline }), { wrapper: Providers });
  await waitFor(() => expect(result.current.state?.awaiting).toBe('ANSWER'));

  const screen = await renderWithProviders(<TireurView sessionId={sessionId} game={result.current} />);
  expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(/^ANCIEN\s\?$/);
  expect(JSON.stringify(screen.toJSON())).not.toMatch(EST_CE);
  await waitFor(() => expect(spoken()).toContain('Ancien ?'));

  const calling: UseGame = {
    ...result.current,
    state: { ...(result.current.state as GameState), awaiting: 'GUESS_CONFIRM', pending_guess: 'ABSALOM' },
  };
  await screen.rerender(<TireurView sessionId={sessionId} game={calling} />);
  expect(screen.getByTestId('incoming-guess-text')).toHaveTextContent('ABSALOM');
  await waitFor(() => expect(spoken()).toContain('Absalom ?'));
  expect(spoken().filter((text) => EST_CE.test(text))).toEqual([]);
});
