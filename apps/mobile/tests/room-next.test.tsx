/**
 * The end of a game in a room: the pair goes on to the next name with the same
 * settings, without making a new room. Roles can be swapped here, between two
 * names, and only here.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';

import { describeRoom } from '@/rooms/room-phase';
import type { RematchOffer } from '@/rooms/rematch';
import { LobbyView } from '@/views/lobby-view';
import { RoomNext } from '@/views/room-next';

import { makeState, renderWithProviders } from './helpers';

const offer = (over: Partial<RematchOffer> = {}): RematchOffer => ({
  oldSessionId: 's1',
  sessionId: 's2',
  roomCode: 'DSA-5678',
  swap: false,
  fromRole: 'TIREUR',
  fromName: 'Awa',
  ...over,
});

describe('"Nom suivant" at the end of a room', () => {
  it('goes on with the same roles, or swaps them, in one tap', async () => {
    const onNext = jest.fn();
    const screen = await renderWithProviders(
      <RoomNext myRole="TIREUR" offer={null} starting={false} onNext={onNext} onHome={jest.fn()} />,
    );
    expect(screen.getByTestId('room-next-name')).toHaveTextContent(/Nom suivant/);
    expect(screen.getByTestId('room-next-swap')).toHaveTextContent('Changer de rôle : tu deviens Découvreur');

    await fireEvent.press(screen.getByTestId('room-next-name'));
    await fireEvent.press(screen.getByTestId('room-next-swap'));
    expect(onNext.mock.calls).toEqual([[false], [true]]);
  });

  it('joins the friend who moved on first, with the roles they chose, and asks nothing else', async () => {
    const onNext = jest.fn();
    const screen = await renderWithProviders(
      <RoomNext myRole="DECOUVREUR" offer={offer({ swap: true })} starting={false} onNext={onNext} onHome={jest.fn()} />,
    );
    expect(screen.getByTestId('rematch-offer')).toHaveTextContent(/Awa passe au nom suivant/);
    expect(screen.getByTestId('rematch-offer')).toHaveTextContent(/tu deviens Tireur/);
    expect(screen.queryByTestId('room-next-swap')).toBeNull();
    expect(screen.queryByTestId('rematch-decline')).toBeNull();

    await fireEvent.press(screen.getByTestId('room-next-name'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed twice while the next game is being made', async () => {
    const onNext = jest.fn();
    const screen = await renderWithProviders(
      <RoomNext myRole="TIREUR" offer={null} starting onNext={onNext} onHome={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('room-next-name'));
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('waiting for the friend', () => {
  const state = makeState({ status: 'WAITING', awaiting: 'NONE', mode: 'HUMAN_VS_HUMAN', room_code: 'DSA-5678' });
  const room = describeRoom({ state, presence: {}, presenceReady: true, otherAbsentSince: null, now: 0, graceMs: 1000 });

  it('shows no code to hand out: the friend joins from the end screen', async () => {
    const screen = await renderWithProviders(
      <LobbyView state={state} room={room} busy={false} onCancel={jest.fn()} rematch={{ friendName: 'Awa' }} />,
    );
    expect(screen.getByTestId('lobby')).toHaveTextContent(/On attend Awa…/);
    expect(screen.queryByTestId('lobby-share')).toBeNull();
    // The settings are still there to read: they are the same as before.
    expect(screen.getByTestId('lobby-timer')).toBeTruthy();
  });

  it('still shows the code for a brand-new room', async () => {
    const screen = await renderWithProviders(<LobbyView state={state} room={room} busy={false} onCancel={jest.fn()} />);
    expect(screen.getByTestId('lobby-share')).toBeTruthy();
  });
});
