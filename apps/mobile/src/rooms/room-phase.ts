import type { Role } from '@dsa/core';

import type { GameState } from '@/services/types';
import type { RoomPresence } from './room-channel';

/**
 * A room between two devices, as one small state machine derived from the server
 * state and the room's presence. Pure, so every step is unit-tested.
 *
 *   LOBBY ──(second player joins)──▶ TIREUR_READY ──("Je suis prêt")──▶ PLAYING ──▶ ENDED
 *
 * TIREUR_READY is the §9 thinking phase: the timed-games session puts its 40 s
 * countdown on exactly this phase.
 */
export type RoomPhase = 'LOBBY' | 'TIREUR_READY' | 'PLAYING' | 'ENDED';

/** How a seat looks in the lobby and the table header. */
export type SeatPresence = 'connected' | 'away' | 'disconnected' | 'unknown' | 'empty';

/** How long the other player may be gone before "L’autre joueur est parti" is shown. */
export const OTHER_GONE_GRACE_MS = 10_000;

export function roomPhaseOf(state: Pick<GameState, 'status' | 'tireur_ready'>): RoomPhase {
  switch (state.status) {
    case 'WAITING':
    case 'READY':
      return 'LOBBY';
    case 'PLAYING':
      return state.tireur_ready ? 'PLAYING' : 'TIREUR_READY';
    default:
      return 'ENDED';
  }
}

export interface Seat {
  role: Role;
  name: string | null;
  isMe: boolean;
  presence: SeatPresence;
}

export interface RoomView {
  phase: RoomPhase;
  myRole: Role | null;
  otherRole: Role | null;
  seats: Record<Role, Seat>;
  /** Both seats taken and both devices connected (not away). */
  bothPresent: boolean;
  /** The other player's device has been gone long enough to offer "Abandonner / Attendre". */
  otherGone: boolean;
}

export interface RoomViewInput {
  state: Pick<GameState, 'status' | 'tireur_ready' | 'players'>;
  presence: RoomPresence;
  /** False until the room channel is subscribed: presence is not known yet. */
  presenceReady: boolean;
  /** When the other seat was last seen going missing (see `trackAbsence`). */
  otherAbsentSince: number | null;
  now: number;
  graceMs?: number;
}

export function describeRoom(input: RoomViewInput): RoomView {
  const { state, presence, presenceReady } = input;
  const phase = roomPhaseOf(state);
  const me = state.players.find((p) => p.is_me && !p.is_ai) ?? null;
  const myRole = me?.role ?? null;
  const otherRole: Role | null = myRole === null ? null : myRole === 'TIREUR' ? 'DECOUVREUR' : 'TIREUR';

  const seat = (role: Role): Seat => {
    const player = state.players.find((p) => p.role === role) ?? null;
    if (!player) return { role, name: null, isMe: false, presence: 'empty' };
    const meta = presence[role];
    const name = player.display_name ?? meta?.name ?? null;
    if (player.is_me) return { role, name, isMe: true, presence: 'connected' };
    let seatPresence: SeatPresence;
    if (!presenceReady) seatPresence = 'unknown';
    else if (!meta) seatPresence = 'disconnected';
    else seatPresence = meta.activity === 'away' ? 'away' : 'connected';
    return { role, name, isMe: false, presence: seatPresence };
  };

  const seats = { TIREUR: seat('TIREUR'), DECOUVREUR: seat('DECOUVREUR') };
  const other = otherRole ? seats[otherRole] : null;
  const graceMs = input.graceMs ?? OTHER_GONE_GRACE_MS;
  const otherGone =
    (phase === 'TIREUR_READY' || phase === 'PLAYING') &&
    other !== null &&
    other.presence === 'disconnected' &&
    input.otherAbsentSince !== null &&
    input.now - input.otherAbsentSince >= graceMs;

  return {
    phase,
    myRole,
    otherRole,
    seats,
    bothPresent: seats.TIREUR.presence === 'connected' && seats.DECOUVREUR.presence === 'connected',
    otherGone,
  };
}

/**
 * Remembers since when a seat has been disconnected: set when it goes missing,
 * cleared as soon as the device is back (connected or away) or the seat is empty.
 */
export function trackAbsence(since: number | null, presence: SeatPresence, now: number): number | null {
  if (presence === 'disconnected') return since ?? now;
  if (presence === 'unknown') return since;
  return null;
}
