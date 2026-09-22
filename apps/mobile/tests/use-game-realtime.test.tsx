/**
 * useGame's side of Realtime (brief S6): only open rooms subscribe; coming back
 * to the foreground resubscribes and refetches; a push that lands while this
 * phone's own action is in flight is not lost.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { GameService } from '@/services/game-service';
import type { GameState } from '@/services/types';
import { useGame } from '@/state/use-game';

import { makeState, Providers } from './helpers';

function roomState(overrides: Partial<GameState> = {}): GameState {
  return makeState({
    mode: 'HUMAN_VS_HUMAN',
    prompt: { node_id: 'n', text: 'ANCIEN', node_type: 'QUESTION', answer_classes: ['OUI', 'NON'] },
    players: [
      { role: 'TIREUR', display_name: 'Awa', is_ai: false, is_me: false },
      { role: 'DECOUVREUR', display_name: 'Bill', is_ai: false, is_me: true },
    ],
    ...overrides,
  });
}

function fakeService(initial: GameState) {
  let current = initial;
  const pushes: (() => void)[] = [];
  let unsubscribed = 0;
  let resolveAsk: ((state: GameState) => void) | null = null;
  const service = {
    offline: false,
    supportsRealtime: true,
    getState: jest.fn(async () => current),
    getMySecret: jest.fn(),
    ask: jest.fn(
      () =>
        new Promise<GameState>((resolve) => {
          resolveAsk = resolve;
        }),
    ),
    subscribe: jest.fn((_id: string, onChange: () => void) => {
      pushes.push(onChange);
      return () => {
        unsubscribed += 1;
      };
    }),
  } as unknown as GameService & { getState: jest.Mock; subscribe: jest.Mock; ask: jest.Mock };
  return {
    service,
    set: (next: GameState) => {
      current = next;
    },
    push: () => pushes[pushes.length - 1]?.(),
    unsubscribed: () => unsubscribed,
    finishAsk: (state: GameState) => resolveAsk?.(state),
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => <Providers>{children}</Providers>;

// React Native's Jest mock of AppState returns no subscription: stand in for it.
let appStateListener: ((state: AppStateStatus) => void) | null = null;
beforeEach(() => {
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => jest.restoreAllMocks());

it('does not subscribe for a game on one phone (LOCAL, AI modes)', async () => {
  const fake = fakeService(roomState({ mode: 'LOCAL' }));
  const { result } = await renderHook(() => useGame('s1', { service: fake.service }), { wrapper });
  await waitFor(() => expect(result.current.state).not.toBeNull());
  expect(fake.service.subscribe).not.toHaveBeenCalled();
  expect(result.current.isRoom).toBe(false);
});

it('subscribes while the room is open, and stops when it ends', async () => {
  const fake = fakeService(roomState({ status: 'WAITING', awaiting: 'NONE', tireur_ready: false }));
  const { result } = await renderHook(() => useGame('s1', { service: fake.service }), { wrapper });
  await waitFor(() => expect(result.current.phase).toBe('LOBBY'));
  expect(fake.service.subscribe).toHaveBeenCalledTimes(1);

  fake.set(roomState({ tireur_ready: false }));
  await act(async () => fake.push());
  await waitFor(() => expect(result.current.phase).toBe('TIREUR_READY'));
  fake.set(roomState());
  await act(async () => fake.push());
  await waitFor(() => expect(result.current.phase).toBe('PLAYING'));
  // Same room, same subscription: no resubscribe on every change.
  expect(fake.service.subscribe).toHaveBeenCalledTimes(1);

  fake.set(roomState({ status: 'ABANDONED', awaiting: 'NONE' }));
  await act(async () => fake.push());
  await waitFor(() => expect(result.current.phase).toBe('ENDED'));
  expect(fake.unsubscribed()).toBe(1);
});

it('back to the foreground: resubscribes and reads the state again', async () => {
  const fake = fakeService(roomState());
  const { result } = await renderHook(() => useGame('s1', { service: fake.service }), { wrapper });
  await waitFor(() => expect(result.current.phase).toBe('PLAYING'));
  const reads = fake.service.getState.mock.calls.length;

  await act(async () => appStateListener?.('background'));
  await act(async () => appStateListener?.('active'));

  await waitFor(() => expect(fake.service.subscribe).toHaveBeenCalledTimes(2));
  expect(fake.unsubscribed()).toBe(1);
  expect(fake.service.getState.mock.calls.length).toBeGreaterThan(reads);
});

it('a push during an action is read once the action is back', async () => {
  const fake = fakeService(roomState());
  const { result } = await renderHook(() => useGame('s1', { service: fake.service }), { wrapper });
  await waitFor(() => expect(result.current.phase).toBe('PLAYING'));

  let asking: Promise<void> | null = null;
  await act(async () => {
    asking = result.current.ask();
  });
  const readsBefore = fake.service.getState.mock.calls.length;
  // The Tireur answers on the other phone before this phone's ask returns.
  fake.set(roomState({ path: [{ step_index: 0, node_id: 'n', text: 'ANCIEN', answer_label: 'OUI', prompt_kind: 'SPINE', node_type: 'QUESTION', target_text: 'HOMME' }] }));
  await act(async () => fake.push());
  expect(fake.service.getState.mock.calls.length).toBe(readsBefore);

  await act(async () => {
    fake.finishAsk(roomState({ awaiting: 'ANSWER' }));
    await asking;
  });
  await waitFor(() => expect(result.current.state?.path).toHaveLength(1));
  expect(fake.service.getState.mock.calls.length).toBe(readsBefore + 1);
});
