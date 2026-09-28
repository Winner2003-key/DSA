/**
 * The live call of a room played with Voix (GAME_RULES.md "Voix in a room is a
 * call"). Nothing here transcribes or recognizes anything: the two players hear
 * each other, and the Tireur ends the game with « Trouvé » or « Pas trouvé ».
 *
 * Two implementations, chosen by Metro like the recorder: `call.native.ts` over
 * `@livekit/react-native`, `call.web.ts` over `livekit-client`. Both are loaded
 * lazily, so a phone without the native module (Expo Go) shows a message instead
 * of crashing at import.
 */

export type CallState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** Why a call could not be held, mapped to what the player is told. */
export type CallErrorCode =
  | 'NEEDS_DEV_BUILD'
  | 'MIC_DENIED'
  | 'TOKEN_REFUSED'
  | 'CONNECT_FAILED';

export class CallError extends Error {
  readonly code: CallErrorCode;
  /** A French line from the server (`message_fr`), when there was one. */
  readonly detail: string | null;

  constructor(code: CallErrorCode, detail: string | null = null) {
    super(code);
    this.name = 'CallError';
    this.code = code;
    this.detail = detail;
  }
}

export interface CallToken {
  url: string;
  token: string;
  /** The call's own deadline, as the server computed it. */
  endsAt: string;
}

/** What the call screen renders. Identities are the players' user ids. */
export interface CallSnapshot {
  state: CallState;
  /** The other phone is in the room. */
  otherPresent: boolean;
  /** This player's microphone is off. */
  muted: boolean;
  /** Identities heard speaking right now. */
  speaking: string[];
  error: CallError | null;
}

export const IDLE_SNAPSHOT: CallSnapshot = {
  state: 'idle',
  otherPresent: false,
  muted: false,
  speaking: [],
  error: null,
};

export interface VoiceCall {
  /** Joins the room. Resolves once connected, throws a `CallError` otherwise. */
  connect(token: CallToken): Promise<void>;
  disconnect(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  /** Called on every change; the same snapshot shape on both platforms. */
  onChange(listener: (snapshot: CallSnapshot) => void): () => void;
  snapshot(): CallSnapshot;
}

/** Nothing to hang up: the platform has no call support at all. */
export function unsupportedCall(code: CallErrorCode = 'NEEDS_DEV_BUILD'): VoiceCall {
  const snapshot: CallSnapshot = { ...IDLE_SNAPSHOT, state: 'failed', error: new CallError(code) };
  return {
    connect: async () => {
      throw new CallError(code);
    },
    disconnect: async () => undefined,
    setMuted: async () => undefined,
    onChange: () => () => undefined,
    snapshot: () => snapshot,
  };
}
