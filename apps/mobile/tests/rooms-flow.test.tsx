/**
 * A room on two phones (brief S6), one phone at a time: the lobby, the
 * "Tireur first" phase as each device sees it, the other player leaving, and a
 * lost connection. The server is a small fake that pushes changes to its
 * subscribers; presence comes from a fake Realtime client.
 */
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { resetRoomsForTests } from '@/rooms/room-channel';
import { setGameService } from '@/services';
import type { GameService } from '@/services/game-service';
import type { RealtimeStatus } from '@/services/realtime-sync';
import type { GameState, Secret } from '@/services/types';
import { useGame } from '@/state/use-game';
import { RoomTable } from '@/views/room-table';

import { renderWithProviders } from './helpers';

// ---- fake Realtime (presence and broadcast on room:<code>) ----------------------
type Handler = (message: { payload?: unknown }) => void;
const realtime = {
  presence: {} as Record<string, unknown[]>,
  channels: [] as { topic: string; sync: (() => void)[]; tracked: unknown[] }[],
  setPresence(next: Record<string, unknown[]>) {
    this.presence = next;
    for (const channel of this.channels) for (const sync of channel.sync) sync();
  },
};

jest.mock('@/services/supabase', () => {
  const actual = jest.requireActual('@/services/supabase');
  return {
    ...actual,
    ensureRealtimeAuth: async () => ({
      channel(topic: string) {
        const entry = { topic, sync: [] as (() => void)[], tracked: [] as unknown[] };
        realtime.channels.push(entry);
        const channel = {
          on(type: string, _filter: { event: string }, handler: Handler) {
            if (type === 'presence') entry.sync.push(() => handler({}));
            return channel;
          },
          subscribe(callback: (status: string) => void) {
            setTimeout(() => callback('SUBSCRIBED'), 0);
            return channel;
          },
          presenceState: () => realtime.presence,
          track: async (payload: unknown) => {
            entry.tracked.push(payload);
          },
          untrack: async () => undefined,
          send: async () => undefined,
        };
        return channel;
      },
      removeChannel: async () => undefined,
    }),
  };
});

// ---- fake server --------------------------------------------------------------
type User = 'awa' | 'bill';

class RoomServer {
  status: GameState['status'] = 'WAITING';
  tireurReady = false;
  players: { role: 'TIREUR' | 'DECOUVREUR'; user: User; name: string }[] = [{ role: 'TIREUR', user: 'awa', name: 'Awa' }];
  awaiting: GameState['awaiting'] = 'NONE';
  listeners = new Set<() => void>();
  statusListeners = new Set<(status: RealtimeStatus) => void>();
  calls: string[] = [];

  emit() {
    for (const listener of this.listeners) listener();
  }

  join(user: User, name: string) {
    this.players.push({ role: 'DECOUVREUR', user, name });
    this.status = 'PLAYING';
    this.awaiting = 'QUESTION';
    this.emit();
  }

  stateFor(user: User): GameState {
    const playing = this.status === 'PLAYING';
    return {
      status: this.status,
      mode: 'HUMAN_VS_HUMAN',
      awaiting: this.awaiting,
      prompt: playing ? { node_id: 'n-ancien', text: 'ANCIEN', node_type: 'QUESTION', answer_classes: ['OUI', 'NON'] } : null,
      dead_end: false,
      pending_guess: null,
      path: [],
      players: this.players.map((p) => ({ role: p.role, display_name: p.name, is_ai: false, is_me: p.user === user })),
      settings: { input_mode: 'BUTTONS' },
      tireur_ready: this.tireurReady,
      room_code: 'DSA-4821',
    };
  }

  serviceFor(user: User): GameService {
    const server = this;
    const state = async () => server.stateFor(user);
    const record = (name: string) => server.calls.push(`${user}:${name}`);
    return {
      offline: false,
      supportsRealtime: true,
      createSession: async () => ({ sessionId: 's1', roomCode: 'DSA-4821' }),
      joinSession: async () => ({ sessionId: 's1', role: 'DECOUVREUR' }),
      getState: state,
      getMySecret: async (): Promise<Secret> => {
        record('getMySecret');
        if (user !== 'awa') throw new Error('WRONG_ROLE');
        return { node_id: 'secret', name: 'CAÏN', description: null, has_homonyms: false };
      },
      tireurReady: async () => {
        record('tireurReady');
        server.tireurReady = true;
        server.emit();
        return server.stateFor(user);
      },
      ask: async () => {
        record('ask');
        server.awaiting = 'ANSWER';
        server.emit();
        return server.stateFor(user);
      },
      answer: state,
      guess: state,
      confirmGuess: state,
      goBack: state,
      rewind: state,
      aiDecouvreurStep: state,
      abandon: async () => {
        record('abandon');
        server.status = 'ABANDONED';
        server.awaiting = 'NONE';
        server.emit();
        return server.stateFor(user);
      },
      rematch: async () => ({ sessionId: 's2', roomCode: 'DSA-5678', role: 'TIREUR' }),
      getRevealedPath: async () => ({ status: server.status, winner: null, path: [], stats: null, secret: null }),
      listNames: async () => ['ADAM', 'CAÏN'],
      subscribe: (_sessionId, onChange, onStatus) => {
        server.listeners.add(onChange);
        if (onStatus) server.statusListeners.add(onStatus);
        setTimeout(() => onStatus?.('SUBSCRIBED'), 0);
        return () => {
          server.listeners.delete(onChange);
          if (onStatus) server.statusListeners.delete(onStatus);
        };
      },
    };
  }
}

function Device({ service, graceMs = 30, lostAfterMs = 4000 }: { service: GameService; graceMs?: number; lostAfterMs?: number }) {
  // The card (useSecret) and the name list read the app-wide service.
  setGameService(service);
  const game = useGame('s1', { service, aiThinkingMs: 0, aiAnswerBeatMs: 0, connectionLostAfterMs: lostAfterMs });
  return <RoomTable sessionId="s1" game={game} graceMs={graceMs} onCancelled={() => undefined} />;
}

const presenceOf = (...roles: ('TIREUR' | 'DECOUVREUR')[]) =>
  Object.fromEntries(roles.map((role, i) => [`client-${i}`, [{ role, name: null, activity: 'active', at: i }]]));

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  realtime.presence = {};
  realtime.channels = [];
});
afterEach(() => {
  resetRoomsForTests();
  setGameService(null);
});

it('lobby: the code, a QR code and the two seats; the room moves on when the Découvreur joins', async () => {
  const server = new RoomServer();
  const screen = await renderWithProviders(<Device service={server.serviceFor('awa')} />);

  await waitFor(() => expect(screen.getByTestId('lobby')).toBeTruthy());
  expect(screen.getByTestId('room-code-digits')).toHaveTextContent('4821');
  expect(screen.getByTestId('room-qr')).toBeTruthy();
  expect(screen.getByTestId('lobby-share')).toBeTruthy();
  expect(screen.getByTestId('lobby-seat-TIREUR-name')).toHaveTextContent('Awa (Toi)');
  expect(screen.getByTestId('lobby-seat-DECOUVREUR-name')).toHaveTextContent('En attente du Découvreur…');
  expect(screen.getByTestId('lobby-seat-TIREUR-presence')).toHaveTextContent('Connecté');
  expect(screen.queryByTestId('lobby-seat-DECOUVREUR-presence')).toBeNull();

  // This phone announces itself on room:DSA-4821.
  await settle();
  expect(realtime.channels.map((c) => c.topic)).toContain('room:DSA-4821');
  expect(realtime.channels.find((c) => c.topic === 'room:DSA-4821')!.tracked).toContainEqual(
    expect.objectContaining({ role: 'TIREUR', name: 'Awa', activity: 'active' }),
  );

  // Bill joins on his phone: the push reaches this one, and the Tireur sees the card first.
  await act(async () => {
    realtime.setPresence(presenceOf('TIREUR', 'DECOUVREUR'));
    server.join('bill', 'Bill');
  });
  await waitFor(() => expect(screen.getByTestId('tireur-ready')).toBeTruthy());
  expect(screen.queryByTestId('lobby')).toBeNull();
});

it('the Découvreur waits on their phone while the Tireur looks at the card, then gets the first question', async () => {
  const server = new RoomServer();
  server.join('bill', 'Bill');
  const bill = server.serviceFor('bill');
  const screen = await renderWithProviders(<Device service={bill} />);

  await waitFor(() => expect(screen.getByTestId('decouvreur-waiting-tireur')).toBeTruthy());
  expect(screen.getByText('Le Tireur découvre sa carte…')).toBeTruthy();
  expect(screen.getByTestId('think-timer-slot')).toBeTruthy();
  expect(screen.queryByTestId('prompt-text')).toBeNull();
  expect(screen.queryByTestId('ask-button')).toBeNull();
  expect(screen.queryByTestId('tireur-ready')).toBeNull();

  // On Awa's phone: "C'est bon, je suis prêt".
  await act(async () => {
    await server.serviceFor('awa').tireurReady('s1');
  });
  await waitFor(() => expect(screen.getByTestId('prompt-text')).toHaveTextContent(/^ANCIEN\s\?$/));
  expect(screen.queryByTestId('decouvreur-waiting-tireur')).toBeNull();
  expect(screen.queryByText('CAÏN')).toBeNull();
  // The Découvreur's phone never asked for the card.
  expect(server.calls.filter((c) => c === 'bill:getMySecret')).toEqual([]);
});

it('the Tireur turns the card over and says they are ready: the server is told, and the phone waits for the question', async () => {
  const server = new RoomServer();
  server.join('bill', 'Bill');
  const screen = await renderWithProviders(<Device service={server.serviceFor('awa')} />);

  await waitFor(() => expect(screen.getByTestId('tireur-ready')).toBeTruthy());
  expect(screen.getByTestId('think-timer-slot')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('secret-toggle'));
  });
  await waitFor(() => expect(screen.getByTestId('secret-name')).toHaveTextContent('CAÏN'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('tireur-ready-done'));
  });
  expect(server.calls).toContain('awa:tireurReady');
  await waitFor(() => expect(screen.getByTestId('tireur-waiting')).toBeTruthy());
  expect(screen.queryByTestId('tireur-ready')).toBeNull();
});

it('the other player leaves: a banner after the grace period, "Attendre" hides it, "Abandonner" ends the game', async () => {
  const server = new RoomServer();
  server.join('bill', 'Bill');
  server.tireurReady = true;
  realtime.presence = presenceOf('TIREUR', 'DECOUVREUR');
  const screen = await renderWithProviders(<Device service={server.serviceFor('awa')} graceMs={30} />);
  await waitFor(() => expect(screen.getByTestId('tireur-waiting')).toBeTruthy());
  await settle();
  expect(screen.queryByTestId('other-gone')).toBeNull();

  // Bill's phone vanishes from the room.
  await act(async () => realtime.setPresence(presenceOf('TIREUR')));
  expect(screen.queryByTestId('other-gone')).toBeNull(); // not before the grace period
  await settle(120);
  await waitFor(() => expect(screen.getByTestId('other-gone')).toBeTruthy());
  expect(screen.getByText('Bill s’est déconnecté.')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('other-gone-wait'));
  });
  expect(screen.queryByTestId('other-gone')).toBeNull();

  // He comes back in the background ("away"), then leaves again.
  await act(async () =>
    realtime.setPresence({ ...presenceOf('TIREUR'), b: [{ role: 'DECOUVREUR', name: 'Bill', activity: 'away', at: 9 }] }),
  );
  await waitFor(() => expect(screen.getByTestId('other-away')).toBeTruthy());
  await act(async () => realtime.setPresence(presenceOf('TIREUR')));
  await settle(120);
  await waitFor(() => expect(screen.getByTestId('other-gone')).toBeTruthy());

  await act(async () => {
    fireEvent.press(screen.getByTestId('other-gone-abandon'));
  });
  expect(server.calls).toContain('awa:abandon');
});

it('shows "Connexion perdue… reconnexion" while the channel is down, and hides it when it is back', async () => {
  const server = new RoomServer();
  server.join('bill', 'Bill');
  server.tireurReady = true;
  const screen = await renderWithProviders(<Device service={server.serviceFor('bill')} lostAfterMs={20} />);
  await waitFor(() => expect(screen.getByTestId('prompt-text')).toBeTruthy());
  await settle();
  expect(screen.queryByTestId('connection-lost')).toBeNull();

  await act(async () => {
    for (const listener of server.statusListeners) listener('RECONNECTING');
  });
  await settle(60);
  await waitFor(() => expect(screen.getByTestId('connection-lost')).toBeTruthy());
  expect(screen.getByText('Connexion perdue… reconnexion')).toBeTruthy();

  await act(async () => {
    for (const listener of server.statusListeners) listener('SUBSCRIBED');
  });
  await waitFor(() => expect(screen.queryByTestId('connection-lost')).toBeNull());
});
