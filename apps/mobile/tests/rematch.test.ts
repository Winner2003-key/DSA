/**
 * "Rejouer" at the end of a room (brief S6): "Mêmes rôles" / "Inverser les rôles"
 * creates the new room on the server and tells the other phone over the room's
 * broadcast channel; accepting joins that same room through the server.
 */
import {
  acceptRematch,
  declineRematch,
  parseRematchDeclined,
  parseRematchOffer,
  proposeRematch,
  rematchPayload,
  roleOnAccept,
  type RematchOffer,
} from '@/rooms/rematch';
import type { GameService } from '@/services/game-service';
import type { RematchSession } from '@/services/types';

/** The server side of dsa_rematch: the first call creates, later calls join. */
function fakeServer() {
  const calls: { sessionId: string; swap: boolean; by: string }[] = [];
  let room: { sessionId: string; roomCode: string; roles: Record<string, 'TIREUR' | 'DECOUVREUR'> } | null = null;
  const oldRoles: Record<string, 'TIREUR' | 'DECOUVREUR'> = { awa: 'TIREUR', bill: 'DECOUVREUR' };
  const serviceFor = (user: string) =>
    ({
      async rematch(sessionId: string, swap: boolean): Promise<RematchSession> {
        calls.push({ sessionId, swap, by: user });
        if (!room) {
          const mine = oldRoles[user]!;
          const role = swap ? (mine === 'TIREUR' ? 'DECOUVREUR' : 'TIREUR') : mine;
          room = { sessionId: 'new-session', roomCode: 'DSA-5678', roles: { [user]: role } };
        } else if (!room.roles[user]) {
          const taken = Object.values(room.roles);
          room.roles[user] = taken.includes('TIREUR') ? 'DECOUVREUR' : 'TIREUR';
        }
        return { sessionId: room.sessionId, roomCode: room.roomCode, role: room.roles[user]! };
      },
    }) as unknown as GameService;
  return { calls, serviceFor };
}

/** Two phones on `room:DSA-1234`: what one sends, the other receives. */
function broadcastPair() {
  const received: { to: string; event: string; payload: unknown }[] = [];
  const phone = (me: string, other: string) => ({
    send: jest.fn(async (event: string, payload: Record<string, unknown>) => {
      received.push({ to: other, event, payload });
    }),
    me,
  });
  return { received, awa: phone('awa', 'bill'), bill: phone('bill', 'awa') };
}

describe('the rematch handshake', () => {
  it('"Inverser les rôles": Awa (Tireur) proposes, Bill accepts and becomes the Tireur', async () => {
    const server = fakeServer();
    const radio = broadcastPair();

    const awaRoom = await proposeRematch(server.serviceFor('awa'), radio.awa, 'old-session', true, { role: 'TIREUR', name: 'Awa' });
    expect(awaRoom).toEqual({ sessionId: 'new-session', roomCode: 'DSA-5678', role: 'DECOUVREUR' });
    expect(server.calls).toEqual([{ sessionId: 'old-session', swap: true, by: 'awa' }]);

    // Bill's phone receives the offer on the old room's channel.
    expect(radio.received).toHaveLength(1);
    const message = radio.received[0]!;
    expect(message).toMatchObject({ to: 'bill', event: 'rematch' });
    const offer = parseRematchOffer(message.payload, 'old-session');
    expect(offer).toEqual({
      oldSessionId: 'old-session',
      sessionId: 'new-session',
      roomCode: 'DSA-5678',
      swap: true,
      fromRole: 'TIREUR',
      fromName: 'Awa',
    });
    expect(roleOnAccept(offer!)).toBe('TIREUR');

    const billRoom = await acceptRematch(server.serviceFor('bill'), offer!);
    expect(billRoom).toEqual({ sessionId: 'new-session', roomCode: 'DSA-5678', role: 'TIREUR' });
    // Accepting goes through the server for the OLD session, never by the code in the message.
    expect(server.calls[1]).toEqual({ sessionId: 'old-session', swap: true, by: 'bill' });
  });

  it('"Mêmes rôles": each player keeps their role', async () => {
    const server = fakeServer();
    const radio = broadcastPair();
    const billRoom = await proposeRematch(server.serviceFor('bill'), radio.bill, 'old-session', false, { role: 'DECOUVREUR', name: 'Bill' });
    expect(billRoom.role).toBe('DECOUVREUR');
    const offer = parseRematchOffer(radio.received[0]!.payload, 'old-session')!;
    expect(offer.swap).toBe(false);
    expect(roleOnAccept(offer)).toBe('TIREUR');
    expect((await acceptRematch(server.serviceFor('awa'), offer)).role).toBe('TIREUR');
  });

  it('both press "Rejouer" at once: they land in the same room', async () => {
    const server = fakeServer();
    const radio = broadcastPair();
    const [a, b] = await Promise.all([
      proposeRematch(server.serviceFor('awa'), radio.awa, 'old-session', false, { role: 'TIREUR', name: 'Awa' }),
      proposeRematch(server.serviceFor('bill'), radio.bill, 'old-session', true, { role: 'DECOUVREUR', name: 'Bill' }),
    ]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(new Set([a.role, b.role])).toEqual(new Set(['TIREUR', 'DECOUVREUR']));
  });

  it('a failed broadcast does not fail the rematch (the other phone can still press "Rejouer")', async () => {
    const server = fakeServer();
    const room = { send: jest.fn(async () => Promise.reject(new Error('socket closed'))) };
    await expect(
      proposeRematch(server.serviceFor('awa'), room, 'old-session', false, { role: 'TIREUR', name: 'Awa' }),
    ).resolves.toMatchObject({ sessionId: 'new-session' });
    await expect(proposeRematch(server.serviceFor('bill'), null, 'old-session', false, { role: 'DECOUVREUR', name: null })).resolves.toMatchObject({
      sessionId: 'new-session',
      // Awa kept the Tireur ("Mêmes rôles"), so Bill joins as the Découvreur.
      role: 'DECOUVREUR',
    });
  });

  it('"Non merci" tells the proposer, for that rematch only', async () => {
    const radio = broadcastPair();
    const offer: RematchOffer = {
      oldSessionId: 'old-session',
      sessionId: 'new-session',
      roomCode: 'DSA-5678',
      swap: false,
      fromRole: 'TIREUR',
      fromName: 'Awa',
    };
    await declineRematch(radio.bill, offer, 'Bill');
    const message = radio.received[0]!;
    expect(message).toMatchObject({ to: 'awa', event: 'rematch_declined' });
    expect(parseRematchDeclined(message.payload, 'old-session', 'new-session')).toEqual({
      oldSessionId: 'old-session',
      sessionId: 'new-session',
      fromName: 'Bill',
    });
    expect(parseRematchDeclined(message.payload, 'old-session', 'another-session')).toBeNull();
  });
});

describe('parseRematchOffer', () => {
  const valid = rematchPayload({
    oldSessionId: 'old-session',
    sessionId: 'new-session',
    roomCode: 'DSA-5678',
    swap: true,
    fromRole: 'DECOUVREUR',
    fromName: null,
  });

  it('accepts a well-formed offer about this game', () => {
    expect(parseRematchOffer(valid, 'old-session')).toMatchObject({ fromRole: 'DECOUVREUR', fromName: null, swap: true });
  });

  it.each([
    ['another game', { ...valid, old_session_id: 'other' }],
    ['no new session', { ...valid, session_id: '' }],
    ['a bad room code', { ...valid, room_code: 'DSA-12' }],
    ['an unknown role', { ...valid, from_role: 'ARBITRE' }],
    ['not an object', 'rematch'],
    ['null', null],
  ])('ignores %s', (_label, payload) => {
    expect(parseRematchOffer(payload, 'old-session')).toBeNull();
  });
});
