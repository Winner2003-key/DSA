import type { Role } from '@dsa/core';

import type { RealtimeStatus } from '@/services/realtime-sync';

/**
 * The room's Realtime channel, `room:<ROOM_CODE>` (DATABASE_SCHEMA.md §4): presence
 * for the lobby ("connecté / absent / déconnecté") and broadcast events between the
 * two devices (`rematch`, and later S7c's WebRTC signaling `offer` / `answer` /
 * `ice` / `hangup`). Nothing sent here is stored, and nothing here is trusted for
 * the game itself: the server's state is always re-read.
 *
 * supabase-js returns the existing channel for a topic, so a room is opened once
 * per device and shared by the screens that need it (lobby, game, result),
 * reference-counted, with a short grace period so moving from one screen to the
 * next doesn't drop the player's presence.
 */

export type PresenceActivity = 'active' | 'away';

export interface PresenceMeta {
  role: Role;
  name: string | null;
  activity: PresenceActivity;
  /** ms since epoch when this meta was tracked; the freshest wins per role. */
  at: number;
}

export type RoomPresence = Partial<Record<Role, PresenceMeta>>;

/** Broadcast events this app listens to. S7c adds its signaling events here. */
export const ROOM_BROADCAST_EVENTS = ['rematch', 'rematch_declined'] as const;
export type RoomBroadcastEvent = (typeof ROOM_BROADCAST_EVENTS)[number];

/** The slice of a supabase-js `RealtimeChannel` used here. */
export interface RoomChannelLike {
  on(type: string, filter: { event: string }, callback: (message: { payload?: unknown }) => void): RoomChannelLike;
  subscribe(callback: (status: string) => void): RoomChannelLike;
  presenceState(): Record<string, unknown[]>;
  track(payload: Record<string, unknown>): Promise<unknown>;
  untrack(): Promise<unknown>;
  send(message: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
}

export interface RealtimeLike {
  channel(topic: string, options?: Record<string, unknown>): RoomChannelLike;
  removeChannel(channel: RoomChannelLike): unknown;
}

export interface RoomListener {
  onPresence?: (presence: RoomPresence) => void;
  onStatus?: (status: RealtimeStatus) => void;
  onBroadcast?: (event: RoomBroadcastEvent, payload: unknown) => void;
}

export interface RoomHandle {
  /** What this device announces. `null` stops announcing. */
  track: (meta: Omit<PresenceMeta, 'at'> | null) => void;
  send: (event: RoomBroadcastEvent, payload: Record<string, unknown>) => Promise<void>;
  close: () => void;
}

export const ROOM_RELEASE_GRACE_MS = 2000;

/** Presence state (one list of metas per client) → the freshest meta per role. */
export function presenceByRole(state: Record<string, unknown[]>): RoomPresence {
  const result: RoomPresence = {};
  for (const metas of Object.values(state)) {
    for (const raw of metas) {
      if (!raw || typeof raw !== 'object') continue;
      const meta = raw as Record<string, unknown>;
      const role = meta.role;
      if (role !== 'TIREUR' && role !== 'DECOUVREUR') continue;
      const entry: PresenceMeta = {
        role,
        name: typeof meta.name === 'string' ? meta.name : null,
        activity: meta.activity === 'away' ? 'away' : 'active',
        at: typeof meta.at === 'number' ? meta.at : 0,
      };
      const current = result[role];
      // An active device wins over an away one; then the most recent.
      if (!current || (current.activity === 'away' && entry.activity === 'active') || (current.activity === entry.activity && entry.at > current.at)) {
        result[role] = entry;
      }
    }
  }
  return result;
}

interface Entry {
  code: string;
  channel: RoomChannelLike | null;
  realtime: RealtimeLike | null;
  listeners: Set<RoomListener>;
  me: PresenceMeta | null;
  status: RealtimeStatus;
  presence: RoomPresence;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  removed: boolean;
}

const rooms = new Map<string, Entry>();

function emit(entry: Entry, fn: (listener: RoomListener) => void) {
  for (const listener of [...entry.listeners]) fn(listener);
}

function start(entry: Entry, connect: () => Promise<RealtimeLike>) {
  connect()
    .then((realtime) => {
      if (entry.removed) return;
      entry.realtime = realtime;
      let channel = realtime.channel(`room:${entry.code}`, {
        config: { broadcast: { self: false }, presence: { enabled: true } },
      });
      channel = channel.on('presence', { event: 'sync' }, () => {
        entry.presence = presenceByRole(channel.presenceState());
        emit(entry, (l) => l.onPresence?.(entry.presence));
      });
      for (const event of ROOM_BROADCAST_EVENTS) {
        channel = channel.on('broadcast', { event }, (message) => {
          emit(entry, (l) => l.onBroadcast?.(event, message.payload));
        });
      }
      entry.channel = channel;
      channel.subscribe((status) => {
        if (entry.removed) return;
        entry.status = status === 'SUBSCRIBED' ? 'SUBSCRIBED' : 'RECONNECTING';
        emit(entry, (l) => l.onStatus?.(entry.status));
        // Presence belongs to a connection: announce again after every (re)join.
        if (status === 'SUBSCRIBED' && entry.me) void channel.track({ ...entry.me }).catch(() => undefined);
      });
    })
    .catch(() => {
      if (entry.removed) return;
      entry.status = 'RECONNECTING';
      emit(entry, (l) => l.onStatus?.(entry.status));
    });
}

function remove(entry: Entry) {
  entry.removed = true;
  rooms.delete(entry.code);
  const { channel, realtime } = entry;
  if (channel && realtime) {
    void channel.untrack().catch(() => undefined);
    void Promise.resolve(realtime.removeChannel(channel)).catch(() => undefined);
  }
}

/**
 * Opens (or shares) `room:<code>`. The listener immediately receives the current
 * status and presence if the room is already open.
 */
export function openRoom(code: string, listener: RoomListener, connect: () => Promise<RealtimeLike>): RoomHandle {
  let entry = rooms.get(code);
  if (!entry) {
    entry = {
      code,
      channel: null,
      realtime: null,
      listeners: new Set(),
      me: null,
      status: 'CONNECTING',
      presence: {},
      releaseTimer: null,
      removed: false,
    };
    rooms.set(code, entry);
    start(entry, connect);
  }
  const room = entry;
  if (room.releaseTimer) {
    clearTimeout(room.releaseTimer);
    room.releaseTimer = null;
  }
  room.listeners.add(listener);
  listener.onStatus?.(room.status);
  listener.onPresence?.(room.presence);

  let closed = false;
  return {
    track: (meta) => {
      if (closed) return;
      room.me = meta ? { ...meta, at: Date.now() } : null;
      if (!room.channel || room.status !== 'SUBSCRIBED') return;
      if (room.me) void room.channel.track({ ...room.me }).catch(() => undefined);
      else void room.channel.untrack().catch(() => undefined);
    },
    send: async (event, payload) => {
      if (!room.channel) throw new Error('room channel not ready');
      await room.channel.send({ type: 'broadcast', event, payload });
    },
    close: () => {
      if (closed) return;
      closed = true;
      room.listeners.delete(listener);
      if (room.listeners.size === 0 && !room.removed) {
        room.releaseTimer = setTimeout(() => {
          room.releaseTimer = null;
          if (room.listeners.size === 0) remove(room);
        }, ROOM_RELEASE_GRACE_MS);
      }
    },
  };
}

/** Test seam: forget every room without touching the channels. */
export function resetRoomsForTests(): void {
  for (const entry of rooms.values()) {
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.removed = true;
  }
  rooms.clear();
}
