/**
 * The Découvreur's screen is the one place a leak would end the game.
 * GRAPH_SPECIFICATION §6 and DATABASE_SCHEMA.md §5: it renders `prompt` and the
 * traversed `path`, calls no secret RPC, and shows nothing else the server sends.
 */
import React from 'react';
import { fireEvent, renderHook, waitFor } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { clearNameCacheForTests } from '@/state/use-names';
import { useGame } from '@/state/use-game';
import type { GameService } from '@/services/game-service';
import type { GameState, RevealedPath, Secret } from '@/services/types';
import { DecouvreurView } from '@/views/decouvreur-view';
import { TireurView } from '@/views/tireur-view';

import { Providers, renderWithProviders } from './helpers';

const SECRET_NAME = 'CAÏN';
const SECRET_NODE_ID = 'c0ffee00-dead-4bee-8000-000000000001';
const SECRET_DESCRIPTION = 'Le meurtrier · LIE A ADAM';

/**
 * A deliberately careless server: the state carries the Tireur's card, both on
 * the player row and at the top level. Nothing in the Découvreur view may render it.
 */
function leakyState(): GameState {
  const state = {
    status: 'PLAYING',
    mode: 'LOCAL',
    awaiting: 'QUESTION',
    prompt: {
      node_id: 'aaaaaaaa-0000-4000-8000-000000000002',
      text: 'CLASSE 1',
      node_type: 'GROUP',
      answer_classes: ['OUI', 'NON'],
    },
    dead_end: false,
    pending_guess: null,
    path: [
      { step_index: 0, node_id: 'p0', text: 'ANCIEN', answer_label: 'OUI', prompt_kind: 'SPINE', node_type: 'QUESTION', target_text: 'HOMME' },
      { step_index: 1, node_id: 'p1', text: 'LIE A ADAM', answer_label: 'OUI', prompt_kind: 'CHILD', node_type: 'CATEGORY', target_text: null },
    ],
    players: [
      {
        role: 'TIREUR',
        display_name: 'Joueur 1',
        is_ai: false,
        is_me: true,
        // Not part of the contract — present precisely to prove it is ignored.
        secret: { node_id: SECRET_NODE_ID, name: SECRET_NAME, description: SECRET_DESCRIPTION },
      },
      { role: 'DECOUVREUR', display_name: 'Joueur 2', is_ai: false, is_me: true },
    ],
    secret: { node_id: SECRET_NODE_ID, name: SECRET_NAME, description: SECRET_DESCRIPTION },
    secret_node_id: SECRET_NODE_ID,
    settings: { input_mode: 'BUTTONS' },
    tireur_ready: true,
    room_code: 'DSA-1234',
  };
  return state as unknown as GameState;
}

class FakeService implements GameService {
  readonly offline = true;
  readonly supportsRealtime = true;
  readonly secretCalls: string[] = [];

  async createSession() {
    return { sessionId: 's1', roomCode: 'DSA-1234' };
  }
  async joinSession() {
    return { sessionId: 's1', role: 'TIREUR' as const };
  }
  async getState(): Promise<GameState> {
    return leakyState();
  }
  async redrawSecret(): Promise<GameState> {
    return leakyState();
  }
  async checkTime(): Promise<GameState> {
    return leakyState();
  }
  async getTimerDefaults() {
    return { think_seconds: 40, play_seconds: 120, max_redraws: 2 };
  }
  /** The picker's tree: sections only, so a Découvreur learns no name from it. */
  async listSections() {
    return [];
  }
  /** Even here the book's path never names the card before the end. */
  async getSolutionPath() {
    return { status: 'DISCOVERED' as const, path: [], secret: null };
  }
  async getMySecret(sessionId: string): Promise<Secret> {
    this.secretCalls.push(sessionId);
    return { node_id: SECRET_NODE_ID, name: SECRET_NAME, description: SECRET_DESCRIPTION, has_homonyms: true };
  }
  async tireurReady() {
    return leakyState();
  }
  async rematch() {
    return { sessionId: 's2', roomCode: 'DSA-5678', role: 'TIREUR' as const };
  }
  async ask() {
    return leakyState();
  }
  async answer() {
    return leakyState();
  }
  async guess() {
    return leakyState();
  }
  async confirmGuess() {
    return leakyState();
  }
  async goBack() {
    return leakyState();
  }
  async rewind() {
    return leakyState();
  }
  async aiDecouvreurStep() {
    return leakyState();
  }
  async abandon() {
    return leakyState();
  }
  async getRevealedPath(): Promise<RevealedPath> {
    return { status: 'PLAYING', winner: null, path: [], stats: null, secret: null };
  }
  async listNames(): Promise<string[]> {
    return ['ADAM', SECRET_NAME, 'DAVID'];
  }
}

/**
 * The views reach for the app-wide service for the name list and the card, so the
 * fake has to be installed globally — otherwise the control below is vacuous.
 */
let current: FakeService;

beforeEach(() => {
  current = new FakeService();
  setGameService(current);
  clearNameCacheForTests();
});

afterEach(() => {
  setGameService(null);
});

function useFakeGame(service: FakeService) {
  return renderHook(() => useGame('s1', { service }), { wrapper: Providers });
}


describe('the Découvreur view', () => {
  it('renders the prompt and the path but never the secret', async () => {
    const service = current;
    const { result } = await useFakeGame(service);
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);

    // It shows what it is allowed to show.
    expect(screen.getByTestId('prompt-text')).toBeTruthy();
    expect(screen.getByText('CLASSE 1 ?')).toBeTruthy();
    expect(screen.getByText('ANCIEN ?')).toBeTruthy();

    // And nothing of the card.
    expect(screen.queryByText(SECRET_NAME)).toBeNull();
    expect(screen.queryByText(SECRET_DESCRIPTION)).toBeNull();
    expect(screen.queryByTestId('secret-card')).toBeNull();
    expect(screen.queryByTestId('secret-name')).toBeNull();

    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toContain(SECRET_NAME);
    expect(tree).not.toContain(SECRET_DESCRIPTION);
    expect(tree).not.toContain(SECRET_NODE_ID);

    // The one RPC that could reveal the card was never called.
    expect(service.secretCalls).toEqual([]);
  });

  it('keeps the card out of the tree even after the Découvreur acts', async () => {
    const service = current;
    const { result } = await useFakeGame(service);
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);
    await screen.rerender(<DecouvreurView game={result.current} />);

    expect(JSON.stringify(screen.toJSON())).not.toContain(SECRET_NAME);
    expect(service.secretCalls).toEqual([]);
  });
});

describe('the Tireur view (the control)', () => {
  it('does show the card, so the test above is not vacuous', async () => {
    const service = current;
    const { result } = await useFakeGame(service);
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const screen = await renderWithProviders(<TireurView sessionId="s1" game={result.current} />);

    // LOCAL hides the card until the Tireur asks for it.
    expect(screen.queryByTestId('secret-name')).toBeNull();
    await waitFor(() => expect(service.secretCalls).toEqual(['s1']));

    fireEvent.press(screen.getByTestId('secret-toggle'));
    await waitFor(() => expect(screen.getByTestId('secret-name')).toHaveTextContent(SECRET_NAME));
  });
});
