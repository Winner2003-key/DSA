/**
 * Brief S7b §8 and the phrasing rule (GAME_RULES "How questions are said", §10):
 * - in a room played with Voix, each phone speaks the other player's move — the
 *   question on the Tireur's phone, the answer on the Découvreur's — so two phones
 *   can play by voice before live audio (S7c);
 * - no UI string and no TTS utterance of a voice game contains "Est-ce" (snapshot).
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { OfflineGameService } from '@/services/offline-game-service';
import type { GameState } from '@/services/types';
import { useGame, type UseGame } from '@/state/use-game';
import { DecouvreurView } from '@/views/decouvreur-view';
import { TireurView } from '@/views/tireur-view';

import { Providers, renderWithProviders } from './helpers';
import { CAIN, closeVoiceHarness, DAVID, EST_CE, resetVoiceHarness, speak, spoken, start } from './voice-harness';

jest.mock('@/speech/recorder', () => require('./fake-recorder'));

beforeEach(resetVoiceHarness);
afterEach(closeVoiceHarness);

/** The same game, seen as one phone of a VOICE room holding `role`. */
function asRoomPhone(game: UseGame, role: 'TIREUR' | 'DECOUVREUR'): UseGame {
  const state = game.state as GameState;
  return {
    ...game,
    isLocal: false,
    isRoom: true,
    myRoles: [role],
    state: {
      ...state,
      mode: 'HUMAN_VS_HUMAN',
      settings: { input_mode: 'VOICE', timed: false, think_seconds: null, play_seconds: null, max_redraws: 2, scope: [] },
      room_code: 'DSA-4821',
      players: [
        { role: 'TIREUR', display_name: 'Awa', is_ai: false, is_me: role === 'TIREUR' },
        { role: 'DECOUVREUR', display_name: 'Bill', is_ai: false, is_me: role === 'DECOUVREUR' },
      ],
    },
  };
}

async function localGame() {
  const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { input_mode: 'VOICE' } });
  await service.tireurReady(sessionId);
  const hook = await renderHook(() => useGame(sessionId, { service }), { wrapper: Providers });
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  return { service, sessionId, hook };
}

it('the Tireur’s phone speaks the question that arrives from the other phone', async () => {
  const { service, sessionId, hook } = await localGame();
  const screen = await renderWithProviders(<TireurView sessionId={sessionId} game={asRoomPhone(hook.result.current, 'TIREUR')} />);
  expect(spoken()).toEqual([]);

  // The Découvreur's phone asks; the push reaches this phone.
  await act(async () => {
    await service.ask(sessionId);
    await hook.result.current.refresh();
  });
  await screen.rerender(<TireurView sessionId={sessionId} game={asRoomPhone(hook.result.current, 'TIREUR')} />);
  await waitFor(() => expect(spoken()).toEqual(['Ancien ?']));
  expect(screen.getByTestId('voice-button-idle')).toBeTruthy();
});

it('the Découvreur’s phone speaks the answer that arrives from the other phone', async () => {
  const { service, sessionId, hook } = await localGame();
  await act(async () => {
    await service.ask(sessionId);
    await hook.result.current.refresh();
  });
  const screen = await renderWithProviders(<DecouvreurView game={asRoomPhone(hook.result.current, 'DECOUVREUR')} />);
  expect(screen.getByTestId('voice-button-disabled')).toBeTruthy();

  await act(async () => {
    await service.answer(sessionId, 'OUI');
    await hook.result.current.refresh();
  });
  await screen.rerender(<DecouvreurView game={asRoomPhone(hook.result.current, 'DECOUVREUR')} />);
  await waitFor(() => expect(spoken()).toEqual(['Oui.']));
  expect(screen.getByTestId('voice-button-idle')).toBeTruthy();
});

it('says nothing with "Est-ce" in a voice game, on screen or aloud (snapshot)', async () => {
  const screens: string[] = [];
  const texts = (tree: unknown): string[] => {
    const out: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === 'string') out.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object' && 'children' in node) walk((node as { children: unknown }).children);
    };
    walk(tree);
    return out;
  };

  // Découvreur against the AI Tireur: ask twice, one misunderstanding, a name call.
  const decouvreur = await start('AI_TIREUR', CAIN);
  await waitFor(() => expect(decouvreur.screen.getByTestId('prompt-text')).toBeTruthy());
  await speak(decouvreur.screen, 500, 'Ancien ?');
  await waitFor(() => expect(decouvreur.screen.getByTestId('prompt-text')).toHaveTextContent(/^HOMME/));
  await speak(decouvreur.screen, 400, 'Hmm…');
  await waitFor(() => expect(decouvreur.screen.getByTestId('voice-notice')).toBeTruthy());
  screens.push(...texts(decouvreur.screen.toJSON()));
  await speak(decouvreur.screen, 500, 'Est-ce un homme ?');
  await waitFor(() => expect(decouvreur.screen.getByTestId('prompt-text')).toHaveTextContent(/^PENTATEUQUE/));
  await speak(decouvreur.screen, 600, 'Abram !');
  await waitFor(() => expect(decouvreur.screen.getByTestId('exchange-latest')).toHaveTextContent(/ABRAM/));
  screens.push(...texts(decouvreur.screen.toJSON()));
  await decouvreur.screen.unmount();

  // Tireur against the AI Découvreur: calibration offer, questions spoken, a borderline answer.
  const tireur = await start('AI_DECOUVREUR', DAVID);
  await waitFor(() => expect(tireur.screen.getByTestId('calibration-offer')).toBeTruthy());
  screens.push(...texts(tireur.screen.toJSON()));
  await waitFor(() => expect(tireur.screen.getByTestId('incoming-question-text')).toBeTruthy());
  await speak(tireur.screen, 300, 'Oui.');
  await waitFor(() => expect(tireur.screen.getByTestId('incoming-question-text')).toHaveTextContent(/^HOMME/));
  await speak(tireur.screen, 300, 'Oui');
  await waitFor(() => expect(tireur.screen.getByTestId('incoming-question-text')).toHaveTextContent(/^PENTATEUQUE/));
  await speak(tireur.screen, 650, 'Non');
  await waitFor(() => expect(tireur.screen.getByTestId('voice-notice')).toHaveTextContent(/Redis-le/));
  screens.push(...texts(tireur.screen.toJSON()));

  const utterances = spoken();
  expect(utterances.filter((text) => EST_CE.test(text))).toEqual([]);
  // "Est-ce un homme ?" was *said* by the player and understood; it is never shown or spoken back.
  expect(screens.filter((text) => EST_CE.test(text) && !text.startsWith('J’ai entendu'))).toEqual([]);
  expect(utterances).toMatchSnapshot('tts-utterances');
});
