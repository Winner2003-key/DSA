import type { Role } from '@dsa/core';

import type { GameService } from '@/services/game-service';
import type { RematchSession } from '@/services/types';
import type { RoomHandle } from './room-channel';

/**
 * "Rejouer" at the end of a room. The server does the real work (`dsa_rematch`
 * creates the new room, or joins it when the other player already created it);
 * the broadcast on the old room's channel only tells the other device that an
 * offer exists. An offer is never trusted: accepting it calls `dsa_rematch` for
 * the old session, which only its players can do.
 */

export interface RematchOffer {
  oldSessionId: string;
  sessionId: string;
  roomCode: string;
  swap: boolean;
  fromRole: Role;
  fromName: string | null;
}

export interface RematchDeclined {
  oldSessionId: string;
  sessionId: string;
  fromName: string | null;
}

export function rematchPayload(offer: RematchOffer): Record<string, unknown> {
  return {
    old_session_id: offer.oldSessionId,
    session_id: offer.sessionId,
    room_code: offer.roomCode,
    swap: offer.swap,
    from_role: offer.fromRole,
    from_name: offer.fromName,
  };
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A `rematch` broadcast about this game, or null (malformed, or about another game). */
export function parseRematchOffer(payload: unknown, oldSessionId: string): RematchOffer | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const sessionId = str(p.session_id);
  const roomCode = str(p.room_code);
  if (str(p.old_session_id) !== oldSessionId || !sessionId || !roomCode || !/^DSA-\d{4}$/.test(roomCode)) return null;
  if (p.from_role !== 'TIREUR' && p.from_role !== 'DECOUVREUR') return null;
  return {
    oldSessionId,
    sessionId,
    roomCode,
    swap: p.swap === true,
    fromRole: p.from_role,
    fromName: str(p.from_name),
  };
}

export function parseRematchDeclined(payload: unknown, oldSessionId: string, sessionId: string): RematchDeclined | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (str(p.old_session_id) !== oldSessionId || str(p.session_id) !== sessionId) return null;
  return { oldSessionId, sessionId, fromName: str(p.from_name) };
}

/** The role the other player gets when they accept an offer. */
export function roleOnAccept(offer: RematchOffer): Role {
  const proposerNewRole: Role = offer.swap ? (offer.fromRole === 'TIREUR' ? 'DECOUVREUR' : 'TIREUR') : offer.fromRole;
  return proposerNewRole === 'TIREUR' ? 'DECOUVREUR' : 'TIREUR';
}

export interface Me {
  role: Role;
  name: string | null;
}

/** Creates (or joins) the new room, then tells the other device. */
export async function proposeRematch(
  service: GameService,
  room: Pick<RoomHandle, 'send'> | null,
  oldSessionId: string,
  swap: boolean,
  me: Me,
): Promise<RematchSession> {
  const next = await service.rematch(oldSessionId, swap);
  const offer: RematchOffer = {
    oldSessionId,
    sessionId: next.sessionId,
    roomCode: next.roomCode,
    swap,
    fromRole: me.role,
    fromName: me.name,
  };
  // The offer is a courtesy: if it can't be sent, "Rejouer" on the other device
  // still lands in the same room.
  await room?.send('rematch', rematchPayload(offer)).catch(() => undefined);
  return next;
}

export function acceptRematch(service: GameService, offer: RematchOffer): Promise<RematchSession> {
  return service.rematch(offer.oldSessionId, offer.swap);
}

export async function declineRematch(room: Pick<RoomHandle, 'send'> | null, offer: RematchOffer, myName: string | null): Promise<void> {
  await room
    ?.send('rematch_declined', { old_session_id: offer.oldSessionId, session_id: offer.sessionId, from_name: myName })
    .catch(() => undefined);
}
