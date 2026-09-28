/**
 * The call on a phone, over `@livekit/react-native` (WebRTC). Audio only.
 *
 * The native module is required **lazily, inside a try**: in Expo Go it is not
 * there, and an import at module load would take the whole screen down. When it
 * is missing the call reports NEEDS_DEV_BUILD and the game still works — the
 * Tireur can declare « Trouvé » or « Pas trouvé » without ever connecting.
 *
 * Echo cancellation and noise suppression are WebRTC's own, and the iOS audio
 * session is put in "call" mode by LiveKit's `AudioSession`. DSA adds no audio
 * processing of its own here: the loudness envelope of S7a is for recognition,
 * and a call recognizes nothing.
 */
import {
  CallError,
  IDLE_SNAPSHOT,
  unsupportedCall,
  type CallSnapshot,
  type CallToken,
  type VoiceCall,
} from './types';

/** Speaker on: two people playing at a table, not a phone against an ear. */
const LOUDSPEAKER = true;

interface LiveKitModule {
  registerGlobals: () => void;
  AudioSession: {
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
    configureAudio?: (config: unknown) => Promise<void>;
  };
  Room: new (options?: unknown) => LiveKitRoom;
  RoomEvent: Record<string, string>;
}

interface LiveKitRoom {
  connect: (url: string, token: string, options?: unknown) => Promise<void>;
  disconnect: () => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  localParticipant: {
    setMicrophoneEnabled: (enabled: boolean) => Promise<unknown>;
    identity?: string;
  };
  remoteParticipants?: Map<string, unknown>;
}

let cached: LiveKitModule | null | undefined;

/** The module, or null in Expo Go. Required once, and never thrown from import. */
function livekit(): LiveKitModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@livekit/react-native') as LiveKitModule;
    module.registerGlobals();
    cached = module;
  } catch {
    cached = null;
  }
  return cached;
}

export function createCall(): VoiceCall {
  const module = livekit();
  if (!module) return unsupportedCall('NEEDS_DEV_BUILD');

  const { AudioSession, Room, RoomEvent } = module;
  let snapshot: CallSnapshot = { ...IDLE_SNAPSHOT };
  const listeners = new Set<(next: CallSnapshot) => void>();
  let room: LiveKitRoom | null = null;
  let sessionStarted = false;

  const emit = (patch: Partial<CallSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };

  const countOthers = (current: LiveKitRoom): number => current.remoteParticipants?.size ?? 0;

  const stopSession = async () => {
    if (!sessionStarted) return;
    sessionStarted = false;
    await AudioSession.stopAudioSession().catch(() => undefined);
  };

  return {
    snapshot: () => snapshot,

    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    connect: async (credentials: CallToken) => {
      emit({ state: 'connecting', error: null });
      try {
        await AudioSession.startAudioSession();
        sessionStarted = true;
        // Loudspeaker, and the iOS session configured for a voice call.
        await AudioSession.configureAudio?.({
          android: { audioTypeOptions: { manageAudioFocus: true } },
          ios: { defaultOutput: LOUDSPEAKER ? 'speaker' : 'earpiece' },
        }).catch(() => undefined);
      } catch {
        await stopSession();
        throw new CallError('MIC_DENIED');
      }

      const next = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      room = next;

      // The event names come from the module, so an SDK that renamed one is
      // simply not listened to rather than crashing on an undefined event.
      const on = (event: string | undefined, handler: (...args: unknown[]) => void) => {
        if (event) next.on(event, handler);
      };
      const refresh = () => emit({ otherPresent: countOthers(next) > 0 });
      on(RoomEvent.ParticipantConnected, refresh);
      on(RoomEvent.ParticipantDisconnected, refresh);
      on(RoomEvent.Reconnecting, () => emit({ state: 'reconnecting' }));
      on(RoomEvent.Reconnected, () => emit({ state: 'connected' }));
      on(RoomEvent.Disconnected, () => {
        emit({ state: 'idle', otherPresent: false, speaking: [] });
        void stopSession();
      });
      on(RoomEvent.ActiveSpeakersChanged, (...args: unknown[]) => {
        const speakers = (args[0] ?? []) as { identity?: string }[];
        emit({ speaking: speakers.map((s) => s.identity ?? '').filter((id) => id !== '') });
      });

      try {
        await next.connect(credentials.url, credentials.token, { autoSubscribe: true });
        await next.localParticipant.setMicrophoneEnabled(true);
      } catch {
        await next.disconnect().catch(() => undefined);
        await stopSession();
        room = null;
        emit({ state: 'failed', error: new CallError('CONNECT_FAILED') });
        throw new CallError('CONNECT_FAILED');
      }

      emit({ state: 'connected', muted: false, otherPresent: countOthers(next) > 0, error: null });
    },

    disconnect: async () => {
      const current = room;
      room = null;
      if (current) await current.disconnect().catch(() => undefined);
      await stopSession();
      emit({ state: 'idle', otherPresent: false, speaking: [] });
    },

    setMuted: async (muted: boolean) => {
      if (!room) return;
      await room.localParticipant.setMicrophoneEnabled(!muted).catch(() => undefined);
      emit({ muted });
    },
  };
}
