import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import type { Role } from '@dsa/core';

import type { RealtimeStatus } from '@/services/realtime-sync';
import { ensureRealtimeAuth } from '@/services/supabase';
import {
  openRoom,
  type RealtimeLike,
  type RoomBroadcastEvent,
  type RoomHandle,
  type RoomPresence,
} from './room-channel';
import { roomJoinUrl } from './room-code';

const WEB_URL = process.env.EXPO_PUBLIC_DSA_WEB_URL ?? null;

/** The link a QR code or the share sheet carries for this room. */
export function joinUrlFor(code: string): string {
  return roomJoinUrl(code, {
    webUrl: WEB_URL,
    createURL: (path) => {
      try {
        return Linking.createURL(path);
      } catch {
        // No app manifest to read the scheme from: the scheme is fixed in app.json.
        return `dsa:/${path}`;
      }
    },
  });
}

const defaultConnect = async (): Promise<RealtimeLike> => (await ensureRealtimeAuth()) as unknown as RealtimeLike;

export interface UseRoomOptions {
  onBroadcast?: (event: RoomBroadcastEvent, payload: unknown) => void;
  /** Injected in tests. */
  connect?: () => Promise<RealtimeLike>;
}

export interface UseRoom {
  presence: RoomPresence;
  /** 'OFF' when there is no room to join (no code yet, or offline mode). */
  status: RealtimeStatus | 'OFF';
  send: (event: RoomBroadcastEvent, payload: Record<string, unknown>) => Promise<void>;
  handle: RoomHandle | null;
}

/**
 * Joins `room:<code>` while mounted and announces this device: its role, the
 * player's name, and whether the app is in the foreground ("away" otherwise).
 */
export function useRoom(code: string | null, me: { role: Role; name: string | null } | null, options: UseRoomOptions = {}): UseRoom {
  const [presence, setPresence] = useState<RoomPresence>({});
  const [status, setStatus] = useState<RealtimeStatus | 'OFF'>('OFF');
  const [handle, setHandle] = useState<RoomHandle | null>(null);
  const [active, setActive] = useState(AppState.currentState !== 'background');

  const onBroadcast = useRef(options.onBroadcast);
  onBroadcast.current = options.onBroadcast;
  const connect = options.connect ?? defaultConnect;

  useEffect(() => {
    if (!code) {
      setStatus('OFF');
      setPresence({});
      setHandle(null);
      return;
    }
    const room = openRoom(
      code,
      {
        onPresence: setPresence,
        onStatus: setStatus,
        onBroadcast: (event, payload) => onBroadcast.current?.(event, payload),
      },
      connect,
    );
    setHandle(room);
    return () => {
      room.close();
      setHandle(null);
    };
    // `connect` is a stable default or a test double.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => subscription.remove();
  }, []);

  const role = me?.role ?? null;
  const name = me?.name ?? null;
  useEffect(() => {
    if (!handle) return;
    handle.track(role ? { role, name, activity: active ? 'active' : 'away' } : null);
  }, [active, handle, name, role, status]);

  const send = useCallback(
    async (event: RoomBroadcastEvent, payload: Record<string, unknown>) => {
      if (!handle) throw new Error('room not open');
      await handle.send(event, payload);
    },
    [handle],
  );

  return { presence, status, send, handle };
}
