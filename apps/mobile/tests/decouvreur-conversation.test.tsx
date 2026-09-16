/**
 * GRAPH_SPECIFICATION §8: the Découvreur's screen is a conversation. Each question
 * is shown with its own answer, and the next question sits in a separate card with
 * no answer next to it — so "SES ENFANTS ? → NON" can never be read.
 */
import React from 'react';
import { act, renderHook, waitFor, within } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import type { GameState } from '@/services/types';
import { clearNameCacheForTests } from '@/state/use-names';
import { useGame, type UseGame } from '@/state/use-game';
import { DecouvreurView } from '@/views/decouvreur-view';

import { Providers, renderWithProviders } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';
const JOSUE = 'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue';
const ANSWER_WORDS = ['OUI', 'NON', 'OUI OUI OUI', 'NON NON NON', 'JE NE SAIS PAS'];

let offline: OfflineGameService;

beforeEach(() => {
  clearNameCacheForTests();
});
afterEach(() => setGameService(null));

async function aiTireurGame(secretKey: string) {
  offline = new OfflineGameService({ persist: false, secretNodeKey: secretKey });
  setGameService(offline);
  const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR' });
  const hook = await renderHook(() => useGame(sessionId, { service: offline, aiAnswerBeatMs: 0 }), { wrapper: Providers });
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  return hook;
}

const noAnswerIn = (element: ReturnType<typeof within>) => {
  for (const word of ANSWER_WORDS) expect(element.queryByText(word)).toBeNull();
};

describe('the Découvreur conversation', () => {
  it('pairs every question with its own answer, and keeps the next question apart', async () => {
    const { result } = await aiTireurGame(CAIN);
    // ANCIEN → OUI, HOMME → OUI, PENTATEUQUE → OUI, LIE A ADAM → OUI, CLASSE 1 → OUI, Premier homme → NON
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await result.current.ask();
      });
    }
    const path = result.current.state!.path;
    expect(path.map((p) => [p.text, p.answer_label])).toEqual([
      ['ANCIEN', 'OUI'],
      ['HOMME', 'OUI'],
      ['PENTATEUQUE', 'OUI'],
      ['LIE A ADAM', 'OUI'],
      ['CLASSE 1', 'OUI'],
      ['Premier homme', 'NON'],
    ]);

    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);

    // The latest pair: the last question asked, and the NON that answered *it*.
    const latest = within(screen.getByTestId('exchange-latest'));
    expect(latest.getByText('Tu as demandé')).toBeTruthy();
    expect(latest.getByText('Premier homme ?')).toBeTruthy();
    expect(screen.getByTestId('exchange-latest-answer')).toHaveTextContent('NON');

    // Earlier exchanges: row i holds question i and answer i, nothing else.
    path.slice(0, -1).forEach((entry, i) => {
      const row = screen.getByTestId(`exchange-${i}`);
      expect(row).toHaveTextContent(new RegExp(`^${entry.text} \\?${entry.answer_label}$`));
    });

    // The next question is in its own card, with no answer anywhere in it.
    const next = screen.getByTestId('next-question');
    expect(within(next).getByText('Question suivante')).toBeTruthy();
    expect(within(next).getByTestId('prompt-text')).toHaveTextContent('Le meurtrier ?');
    noAnswerIn(within(next));
    // …and the question it will ask is not in the pair above it.
    expect(latest.queryByText('Le meurtrier ?')).toBeNull();
  });

  it('shows "Le Tireur réfléchit…" with the question just asked, and no stale answer beside it', async () => {
    const { result } = await aiTireurGame(CAIN);
    await act(async () => {
      await result.current.ask(); // ANCIEN → OUI
    });
    // A human Tireur (a room) has not answered HOMME yet.
    const waiting: UseGame = {
      ...result.current,
      state: { ...(result.current.state as GameState), mode: 'HUMAN_VS_HUMAN', awaiting: 'ANSWER' },
      activeRole: 'TIREUR',
    };
    const screen = await renderWithProviders(<DecouvreurView game={waiting} />);

    const card = screen.getByTestId('waiting-card');
    expect(within(card).getByText('Tu as demandé')).toBeTruthy();
    expect(within(card).getByTestId('waiting-text')).toHaveTextContent('HOMME ?');
    expect(within(card).getByText('Le Tireur réfléchit…')).toBeTruthy();
    noAnswerIn(within(card));

    expect(screen.queryByTestId('next-question')).toBeNull();
    expect(screen.queryByTestId('ask-button')).toBeNull();
    // The pair above is still ANCIEN with its own OUI.
    expect(within(screen.getByTestId('exchange-latest')).getByText('ANCIEN ?')).toBeTruthy();
    expect(screen.getByTestId('exchange-latest-answer')).toHaveTextContent('OUI');
  });

  it('shows a refused name call as its own pair: "Tu as proposé" → NON', async () => {
    const { result } = await aiTireurGame(CAIN);
    await act(async () => {
      await result.current.ask(); // ANCIEN → OUI
    });
    await act(async () => {
      await result.current.guess('ABSALOM');
    });
    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);

    const latest = within(screen.getByTestId('exchange-latest'));
    expect(latest.getByText('Tu as proposé')).toBeTruthy();
    expect(latest.getByText('ABSALOM')).toBeTruthy();
    expect(screen.getByTestId('exchange-latest-answer')).toHaveTextContent('NON');
    expect(screen.getByTestId('exchange-0')).toHaveTextContent(/^ANCIEN \?OUI$/);
    expect(within(screen.getByTestId('next-question')).getByTestId('prompt-text')).toHaveTextContent('HOMME ?');
  });

  it('says "Plus de question dans cette liste" at a dead end, with going back first', async () => {
    const { result } = await aiTireurGame(CAIN);
    // Force a dead end the way a mistaken human Tireur would: play it in LOCAL.
    const local = new OfflineGameService({ persist: false, secretNodeKey: JOSUE });
    setGameService(local);
    const { sessionId } = await local.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    for (const label of ['OUI', 'OUI', 'NON', 'NON']) {
      await local.ask(sessionId);
      await local.answer(sessionId, label);
    }
    const hook = await renderHook(() => useGame(sessionId, { service: local }), { wrapper: Providers });
    await waitFor(() => expect(hook.result.current.state?.dead_end).toBe(true));
    expect(result.current.state).not.toBeNull();

    const screen = await renderWithProviders(<DecouvreurView game={hook.result.current} />);
    const card = within(screen.getByTestId('dead-end'));
    expect(card.getByText('Plus de question dans cette liste')).toBeTruthy();
    expect(card.getByText('Revenir à une question')).toBeTruthy();
    expect(screen.queryByTestId('next-question')).toBeNull();
    expect(screen.getByTestId('exchange-latest-answer')).toHaveTextContent('NON');
  });
});
