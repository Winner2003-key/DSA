/**
 * The call in a browser, over `livekit-client`. Audio only, and the same
 * `VoiceCall` surface as the phone (`call.native.ts`), so the call screen never
 * branches on the platform.
 *
 * The import is lazy for the same reason as on native: a browser without WebRTC,
 * or a page served over plain http, must show a message rather than a blank
 * screen. Echo cancellation and noise suppression are the browser's own.
 */
import {
  CallError,
  IDLE_SNAPSHOT,
  type CallSnapshot,
  type CallToken,
  type VoiceCall,
} from './types';

interface LiveKitClientModule {
  Room: new (options?: unknown) => LiveKitRoom;
  RoomEvent: Record<string, string>;
}

interface LiveKitRoom {
  connect: (url: string, token: string, options?: unknown) => Promise<void>;
  disconnect: () => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  localParticipant: { setMicrophoneEnabled: (enabled: boolean) => Promise<unknown> };
  remoteParticipants?: Map<string, unknown>;
}

let cached: LiveKitClientModule | null | undefined;

function livekit(): LiveKitClientModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('livekit-client') as LiveKitClientModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function createCall(): VoiceCall {
  let snapshot: CallSnapshot = { ...IDLE_SNAPSHOT };
  const listeners = new Set<(next: CallSnapshot) => void>();
  let room: LiveKitRoom | null = null;

  const emit = (patch: Partial<CallSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };

  return {
    snapshot: () => snapshot,

    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    connect: async (credentials: CallToken) => {
      const module = livekit();
      if (!module) {
        const failure = new CallError('NEEDS_DEV_BUILD');
        emit({ state: 'failed', error: failure });
        throw failure;
      }
      const { Room, RoomEvent } = module;
      emit({ state: 'connecting', error: null });

      const next = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      room = next;

      // As on native: an event this SDK version does not have is not listened to.
      const on = (event: string | undefined, handler: (...args: unknown[]) => void) => {
        if (event) next.on(event, handler);
      };
      const refresh = () => emit({ otherPresent: (next.remoteParticipants?.size ?? 0) > 0 });
      on(RoomEvent.ParticipantConnected, refresh);
      on(RoomEvent.ParticipantDisconnected, refresh);
      on(RoomEvent.Reconnecting, () => emit({ state: 'reconnecting' }));
      on(RoomEvent.Reconnected, () => emit({ state: 'connected' }));
      on(RoomEvent.Disconnected, () => emit({ state: 'idle', otherPresent: false, speaking: [] }));
      on(RoomEvent.ActiveSpeakersChanged, (...args: unknown[]) => {
        const speakers = (args[0] ?? []) as { identity?: string }[];
        emit({ speaking: speakers.map((s) => s.identity ?? '').filter((id) => id !== '') });
      });

      try {
        await next.connect(credentials.url, credentials.token, { autoSubscribe: true });
        // The browser asks for the microphone here, so a refusal is a refusal of the mic.
        await next.localParticipant.setMicrophoneEnabled(true);
      } catch (caught) {
        await next.disconnect().catch(() => undefined);
        room = null;
        const denied = caught instanceof Error && /permission|not allowed|denied/i.test(caught.message);
        const failure = new CallError(denied ? 'MIC_DENIED' : 'CONNECT_FAILED');
        emit({ state: 'failed', error: failure });
        throw failure;
      }

      emit({ state: 'connected', muted: false, otherPresent: (next.remoteParticipants?.size ?? 0) > 0, error: null });
    },

    disconnect: async () => {
      const current = room;
      room = null;
      if (current) await current.disconnect().catch(() => undefined);
      emit({ state: 'idle', otherPresent: false, speaking: [] });
    },

    setMuted: async (muted: boolean) => {
      if (!room) return;
      await room.localParticipant.setMicrophoneEnabled(!muted).catch(() => undefined);
      emit({ muted });
    },
  };
}
