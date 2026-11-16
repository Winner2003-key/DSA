/**
 * A game is not one name. Once a name is found, « Nom suivant » draws the next
 * one with the settings already in force — the mode, Voix or Boutons, the
 * chronometer and the part of the book — and only « Changer les réglages » goes
 * back through « Nouvelle partie ».
 */
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import ResultatScreen from '../app/resultat/[sessionId]';

import { renderWithProviders } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';

const mockReplace = jest.fn();
let mockSessionId = '';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ sessionId: mockSessionId }),
}));

/** Plays a LOCAL game of the mini book to the end and returns its service. */
async function playedGame(settings: { timed?: boolean; scope?: string[] } = {}) {
  const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  const { sessionId } = await service.createSession({
    graphSlug: 'mini',
    mode: 'AI_TIREUR',
    settings: { input_mode: 'BUTTONS', timed: false, scope: [], ...settings },
  });
  for (let i = 0; i < 7; i++) await service.ask(sessionId);
  await service.guess(sessionId, 'caïn');
  expect((await service.getState(sessionId)).status).toBe('DISCOVERED');
  mockSessionId = sessionId;
  return { service, sessionId };
}

afterEach(() => {
  setGameService(null);
  mockReplace.mockClear();
});

describe('after a name is found', () => {
  it('« Nom suivant » starts another game with the very same settings', async () => {
    const evangiles = (await new OfflineGameService({ persist: false }).listSections('mini')).find(
      (section) => section.label === 'LES EVANGILES',
    )!;
    const { service, sessionId } = await playedGame({ timed: true, scope: [evangiles.node_id] });
    setGameService(service);

    const screen = await renderWithProviders(<ResultatScreen />);
    await waitFor(() => expect(screen.getByTestId('next-name')).toBeTruthy());
    // The button says what the next name will be played with.
    expect(screen.getByTestId('next-name')).toHaveTextContent(/Boutons · Chronomètre · LES EVANGILES/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('next-name'));
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const target = String(mockReplace.mock.calls.at(-1)?.[0]);
    expect(target.startsWith('/partie/')).toBe(true);

    const next = target.slice('/partie/'.length);
    expect(next).not.toBe(sessionId);
    const state = await service.getState(next);
    expect(state.mode).toBe('AI_TIREUR');
    expect(state.settings.timed).toBe(true);
    expect(state.settings.input_mode).toBe('BUTTONS');
    expect(state.settings.scope).toEqual([evangiles.node_id]);
    expect(state.status).not.toBe('DISCOVERED');
  });

  it('« Changer les réglages » is the only way back to « Nouvelle partie »', async () => {
    const { service } = await playedGame();
    setGameService(service);

    const screen = await renderWithProviders(<ResultatScreen />);
    await waitFor(() => expect(screen.getByTestId('replay')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('replay'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/jouer?mode=AI_TIREUR');
  });
});
