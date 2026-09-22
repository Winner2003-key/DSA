/**
 * GRAPH_SPECIFICATION §8: the card's description is shown only when another person
 * in the book has the same name — on the Tireur's card and on the result screen.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';

import { ResultHeader, SecretCard } from '@/components';
import type { RevealedPath, Secret } from '@/services/types';

import { makeStats, renderWithProviders } from './helpers';

const JACQUES: Secret = {
  node_id: 'n-jacques',
  name: 'JACQUES',
  description: "Fils d'Alphée · LES EVANGILES",
  has_homonyms: true,
};
const CAIN: Secret = { node_id: 'n-cain', name: 'CAÏN', description: 'Le meurtrier · LIE A ADAM', has_homonyms: false };

const reveal = (secret: Secret): RevealedPath => ({
  status: 'DISCOVERED',
  winner: 'DECOUVREUR',
  path: [],
  stats: makeStats({ questions: 7, non: 1 }),
  secret,
});

describe('the Tireur card', () => {
  it('hides the description when nobody else has the name', async () => {
    const screen = await renderWithProviders(<SecretCard secret={CAIN} revealed onToggle={() => undefined} />);
    expect(screen.getByTestId('secret-name')).toHaveTextContent('CAÏN');
    expect(screen.queryByTestId('secret-description')).toBeNull();
    expect(screen.queryByText(CAIN.description!)).toBeNull();
  });

  it('shows the description when the name is shared', async () => {
    const screen = await renderWithProviders(<SecretCard secret={JACQUES} revealed onToggle={() => undefined} />);
    expect(screen.getByTestId('secret-name')).toHaveTextContent('JACQUES');
    expect(screen.getByTestId('secret-description')).toHaveTextContent("Fils d'Alphée · LES EVANGILES");
  });

  it('shows neither name nor description face down, and turns over on a tap', async () => {
    let revealed = false;
    const screen = await renderWithProviders(
      <SecretCard secret={JACQUES} revealed={revealed} onToggle={() => (revealed = !revealed)} />,
    );
    expect(screen.queryByTestId('secret-name')).toBeNull();
    expect(screen.queryByText(JACQUES.description!)).toBeNull();
    fireEvent.press(screen.getByTestId('secret-toggle'));
    expect(revealed).toBe(true);
  });
});

describe('the result screen header', () => {
  it('hides the description when nobody else has the name', async () => {
    const screen = await renderWithProviders(<ResultHeader reveal={reveal(CAIN)} />);
    expect(screen.getByTestId('result-name')).toHaveTextContent('CAÏN');
    expect(screen.queryByTestId('result-description')).toBeNull();
    expect(screen.queryByText(CAIN.description!)).toBeNull();
  });

  it('shows the description when the name is shared', async () => {
    const screen = await renderWithProviders(<ResultHeader reveal={reveal(JACQUES)} />);
    expect(screen.getByTestId('result-description')).toHaveTextContent("Fils d'Alphée · LES EVANGILES");
  });

  it('prints the server stats instead of counting on the client', async () => {
    const screen = await renderWithProviders(<ResultHeader reveal={{ ...reveal(CAIN), stats: makeStats({ questions: 8, non: 2, backs: 1, rewinds: 1 }) }} />);
    expect(screen.getByTestId('result-stats')).toHaveTextContent(/8 questions.*2 non.*2 retours/);
  });
});
