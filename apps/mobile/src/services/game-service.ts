import type { RealtimeStatus } from './realtime-sync';
import type {
  CreateSessionOptions,
  CreatedSession,
  GameState,
  JoinedSession,
  RematchSession,
  RevealedPath,
  Secret,
} from './types';

/**
 * The only way the UI touches a game. Two implementations exist:
 * `SupabaseGameService` (RPCs over the hosted database) and `OfflineGameService`
 * (`@dsa/core` + the mini graph fixture, for development and demos).
 *
 * Rules never live above this line: a method either returns the new state JSON or
 * throws a `DsaError` carrying a French message.
 */
export interface GameService {
  /** True for the local demo implementation; the UI shows a badge when it is. */
  readonly offline: boolean;

  /**
   * True when the service pushes changes by itself (`subscribe`). While it is false
   * the hook polls the modes that need remote updates.
   */
  readonly supportsRealtime: boolean;

  createSession(options: CreateSessionOptions): Promise<CreatedSession>;
  joinSession(roomCode: string, displayName?: string): Promise<JoinedSession>;

  getState(sessionId: string): Promise<GameState>;
  /** TIREUR only. A Découvreur screen must never call this. */
  getMySecret(sessionId: string): Promise<Secret>;

  /** TIREUR: "Je suis prêt" in a room — the Découvreur may ask from now on. */
  tireurReady(sessionId: string): Promise<GameState>;
  ask(sessionId: string): Promise<GameState>;
  answer(sessionId: string, answerLabel: string): Promise<GameState>;
  guess(sessionId: string, name: string): Promise<GameState>;
  confirmGuess(sessionId: string, answerLabel: string): Promise<GameState>;
  goBack(sessionId: string, stepIndex: number): Promise<GameState>;
  rewind(sessionId: string, count: 1 | 2 | 3): Promise<GameState>;
  aiDecouvreurStep(sessionId: string): Promise<GameState>;
  abandon(sessionId: string): Promise<GameState>;

  /**
   * "Rejouer" at the end of a room. The first call creates the new room (keeping
   * or swapping the caller's role); the other player's call joins that same room.
   */
  rematch(sessionId: string, swapRoles: boolean): Promise<RematchSession>;

  getRevealedPath(sessionId: string): Promise<RevealedPath>;
  listNames(graphSlug: string): Promise<string[]>;

  /**
   * Push channel for one session. `onChange` is called (debounced, with no payload)
   * whenever the session, its players or its moves change, so the hook refetches
   * through `getState`. `onStatus` reports the channel; while it is not
   * `SUBSCRIBED` the subscription polls instead. Returns the unsubscribe function.
   */
  subscribe?(sessionId: string, onChange: () => void, onStatus?: (status: RealtimeStatus) => void): () => void;
}
