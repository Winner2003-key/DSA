/**
 * The room state machine (brief S6): waiting, both present, Tireur ready,
 * playing, and the other player gone — derived from the server state plus the
 * room's presence, never from the client alone.
 */
import { presenceByRole, type RoomPresence } from '@/rooms/room-channel';
import { describeRoom, roomPhaseOf, trackAbsence, OTHER_GONE_GRACE_MS } from '@/rooms/room-phase';
import type { GameState, StatePlayer } from '@/services/types';

const tireur = (me: boolean, name = 'Awa'): StatePlayer => ({ role: 'TIREUR', display_name: name, is_ai: false, is_me: me });
const decouvreur = (me: boolean, name = 'Bill'): StatePlayer => ({ role: 'DECOUVREUR', display_name: name, is_ai: false, is_me: me });

function state(status: GameState['status'], players: StatePlayer[], tireurReady = false) {
  return { status, players, tireur_ready: tireurReady };
}

const here = (role: 'TIREUR' | 'DECOUVREUR', activity: 'active' | 'away' = 'active'): RoomPresence => ({
  [role]: { role, name: null, activity, at: 1 },
});

const NOW = 1_000_000;

describe('roomPhaseOf', () => {
  it('follows the server: WAITING → TIREUR_READY → PLAYING → ENDED', () => {
    expect(roomPhaseOf({ status: 'WAITING', tireur_ready: false })).toBe('LOBBY');
    expect(roomPhaseOf({ status: 'PLAYING', tireur_ready: false })).toBe('TIREUR_READY');
    expect(roomPhaseOf({ status: 'PLAYING', tireur_ready: true })).toBe('PLAYING');
    expect(roomPhaseOf({ status: 'DISCOVERED', tireur_ready: true })).toBe('ENDED');
    expect(roomPhaseOf({ status: 'ABANDONED', tireur_ready: false })).toBe('ENDED');
  });
});

describe('describeRoom', () => {
  it('waiting: my seat is taken and connected, the other seat is empty', () => {
    const view = describeRoom({
      state: state('WAITING', [tireur(true)]),
      presence: here('TIREUR'),
      presenceReady: true,
      otherAbsentSince: null,
      now: NOW,
    });
    expect(view.phase).toBe('LOBBY');
    expect(view.myRole).toBe('TIREUR');
    expect(view.otherRole).toBe('DECOUVREUR');
    expect(view.seats.TIREUR).toEqual({ role: 'TIREUR', name: 'Awa', isMe: true, presence: 'connected' });
    expect(view.seats.DECOUVREUR).toEqual({ role: 'DECOUVREUR', name: null, isMe: false, presence: 'empty' });
    expect(view.bothPresent).toBe(false);
    expect(view.otherGone).toBe(false);
  });

  it('presence is "unknown" until the room channel is subscribed (no false "Déconnecté")', () => {
    const view = describeRoom({
      state: state('PLAYING', [tireur(false), decouvreur(true)]),
      presence: {},
      presenceReady: false,
      otherAbsentSince: NOW - OTHER_GONE_GRACE_MS * 10,
      now: NOW,
    });
    expect(view.seats.TIREUR.presence).toBe('unknown');
    expect(view.otherGone).toBe(false);
  });

  it('both present: the second player joined and both phones are connected', () => {
    const view = describeRoom({
      state: state('PLAYING', [tireur(false), decouvreur(true)]),
      presence: { ...here('TIREUR'), ...here('DECOUVREUR') },
      presenceReady: true,
      otherAbsentSince: null,
      now: NOW,
    });
    expect(view.phase).toBe('TIREUR_READY');
    expect(view.myRole).toBe('DECOUVREUR');
    expect(view.bothPresent).toBe(true);
    expect(view.seats.TIREUR.name).toBe('Awa');
  });

  it('away: the other app is in the background, which is not "gone"', () => {
    const view = describeRoom({
      state: state('PLAYING', [tireur(true), decouvreur(false)], true),
      presence: { ...here('TIREUR'), ...here('DECOUVREUR', 'away') },
      presenceReady: true,
      otherAbsentSince: null,
      now: NOW,
    });
    expect(view.phase).toBe('PLAYING');
    expect(view.seats.DECOUVREUR.presence).toBe('away');
    expect(view.bothPresent).toBe(false);
    expect(view.otherGone).toBe(false);
  });

  it('ready → playing: the Tireur said "Je suis prêt"', () => {
    const players = [tireur(true), decouvreur(false)];
    const presence = { ...here('TIREUR'), ...here('DECOUVREUR') };
    const before = describeRoom({ state: state('PLAYING', players, false), presence, presenceReady: true, otherAbsentSince: null, now: NOW });
    const after = describeRoom({ state: state('PLAYING', players, true), presence, presenceReady: true, otherAbsentSince: null, now: NOW });
    expect([before.phase, after.phase]).toEqual(['TIREUR_READY', 'PLAYING']);
  });

  it('other player gone: disconnected for the whole grace period, while the game is on', () => {
    const input = {
      state: state('PLAYING', [tireur(true), decouvreur(false)], true),
      presence: here('TIREUR'),
      presenceReady: true,
    };
    expect(describeRoom({ ...input, otherAbsentSince: NOW, now: NOW }).seats.DECOUVREUR.presence).toBe('disconnected');
    expect(describeRoom({ ...input, otherAbsentSince: NOW, now: NOW + OTHER_GONE_GRACE_MS - 1 }).otherGone).toBe(false);
    expect(describeRoom({ ...input, otherAbsentSince: NOW, now: NOW + OTHER_GONE_GRACE_MS }).otherGone).toBe(true);
    // also during the Tireur-ready phase
    expect(
      describeRoom({ ...input, state: state('PLAYING', input.state.players, false), otherAbsentSince: NOW, now: NOW + OTHER_GONE_GRACE_MS })
        .otherGone,
    ).toBe(true);
    // never in the lobby (nobody to wait for) nor after the end
    expect(describeRoom({ ...input, state: state('WAITING', [tireur(true)]), otherAbsentSince: NOW, now: NOW + 60_000 }).otherGone).toBe(false);
    expect(
      describeRoom({ ...input, state: state('ABANDONED', input.state.players, true), otherAbsentSince: NOW, now: NOW + 60_000 }).otherGone,
    ).toBe(false);
  });
});

describe('trackAbsence', () => {
  it('starts when the other phone disappears, keeps its start, and clears when it is back', () => {
    let since = trackAbsence(null, 'connected', 10);
    expect(since).toBeNull();
    since = trackAbsence(since, 'disconnected', 20);
    expect(since).toBe(20);
    since = trackAbsence(since, 'disconnected', 30);
    expect(since).toBe(20);
    since = trackAbsence(since, 'unknown', 40); // the channel reconnects: keep counting
    expect(since).toBe(20);
    since = trackAbsence(since, 'away', 50);
    expect(since).toBeNull();
    expect(trackAbsence(5, 'empty', 60)).toBeNull();
  });
});

describe('presenceByRole', () => {
  it('reads one meta per role; an active phone wins over an away one, then the freshest', () => {
    const presence = presenceByRole({
      'client-a': [{ role: 'TIREUR', name: 'Awa', activity: 'away', at: 50 }],
      'client-b': [{ role: 'TIREUR', name: 'Awa', activity: 'active', at: 10 }],
      'client-c': [
        { role: 'DECOUVREUR', name: 'Bill', activity: 'active', at: 5 },
        { role: 'DECOUVREUR', name: 'Bill 2', activity: 'active', at: 9 },
      ],
      'client-d': [{ role: 'INTRUDER', name: 'x' }, null, 'junk'],
    });
    expect(presence.TIREUR).toEqual({ role: 'TIREUR', name: 'Awa', activity: 'active', at: 10 });
    expect(presence.DECOUVREUR?.name).toBe('Bill 2');
    expect(Object.keys(presence).sort()).toEqual(['DECOUVREUR', 'TIREUR']);
  });
});
