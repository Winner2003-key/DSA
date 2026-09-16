/**
 * GRAPH_SPECIFICATION §8: a LOCAL game starts with the Tireur. The phone goes to the
 * Tireur, who turns the card over and says they are ready; then it goes to the
 * Découvreur for the first question.
 */
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import { clearNameCacheForTests } from '@/state/use-names';
import { useGame } from '@/state/use-game';
import { GameTable } from '@/views/game-table';

import { renderWithProviders } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';

function Table({ sessionId, service }: { sessionId: string; service: OfflineGameService }) {
  const game = useGame(sessionId, { service });
  return <GameTable sessionId={sessionId} game={game} />;
}

afterEach(() => setGameService(null));

/** Presses, and lets the service call it starts settle inside act(). */
async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

it('hands the phone to the Tireur first, then to the Découvreur for the first question', async () => {
  clearNameCacheForTests();
  const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  setGameService(service);
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });

  const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);

  // 1. "Passe le téléphone au Tireur" — and nothing of the game behind it.
  await waitFor(() => expect(screen.getByTestId('pass-phone-TIREUR')).toBeTruthy());
  expect(screen.getByText('au Tireur')).toBeTruthy();
  expect(screen.queryByTestId('pass-phone-DECOUVREUR')).toBeNull();
  expect(screen.queryByTestId('prompt-text')).toBeNull();
  expect(screen.queryByTestId('ask-button')).toBeNull();
  expect(screen.getByTestId('seat-TIREUR')).toBeTruthy();

  // 2. The Tireur looks at the card.
  await press(screen.getByTestId('pass-ready'));
  await waitFor(() => expect(screen.getByTestId('tireur-ready')).toBeTruthy());
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('À toi');
  expect(screen.queryByTestId('secret-name')).toBeNull();
  await press(screen.getByTestId('secret-toggle'));
  await waitFor(() => expect(screen.getByTestId('secret-name')).toHaveTextContent('CAÏN'));
  expect(screen.queryByTestId('ask-button')).toBeNull();

  // 3. "C'est bon, je suis prêt" → the phone goes to the Découvreur, card gone.
  await press(screen.getByTestId('tireur-ready-done'));
  await waitFor(() => expect(screen.getByTestId('pass-phone-DECOUVREUR')).toBeTruthy());
  expect(screen.queryByTestId('secret-name')).toBeNull();
  expect(screen.queryByText('CAÏN')).toBeNull();

  // 4. The first question.
  await press(screen.getByTestId('pass-ready'));
  await waitFor(() => expect(screen.getByTestId('prompt-text')).toHaveTextContent('ANCIEN ?'));
  expect(screen.queryByTestId('tireur-ready')).toBeNull();
  expect(screen.queryByText('CAÏN')).toBeNull();

  // 5. Asking hands the phone back to the Tireur, who now sees the question to answer.
  await press(screen.getByTestId('ask-button'));
  await waitFor(() => expect(screen.getByTestId('pass-phone-TIREUR')).toBeTruthy());
  await press(screen.getByTestId('pass-ready'));
  await waitFor(() => expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(/^ANCIEN\s\?$/));
  // The pad shows only the classes this question allows (ANCIEN: OUI, NON).
  expect(screen.getByTestId('answer-OUI')).toBeTruthy();
  expect(screen.getByTestId('answer-NON')).toBeTruthy();
  expect(screen.queryByTestId('answer-OUI_REPETE')).toBeNull();
  expect(screen.queryByTestId('answer-JE_NE_SAIS_PAS')).toBeNull();
});

it('does not repeat the hand-over for a LOCAL game that already started', async () => {
  const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  setGameService(service);
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
  await service.ask(sessionId);
  await service.answer(sessionId, 'OUI');

  const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);
  await waitFor(() => expect(screen.getByTestId('pass-phone-DECOUVREUR')).toBeTruthy());
  expect(screen.queryByTestId('tireur-ready')).toBeNull();
});
