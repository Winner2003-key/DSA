import type {
  CreateSessionOptions,
  CreatedSession,
  GameState,
  JoinedSession,
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
   * True when the service pushes changes by itself. While it is false the hook
   * polls for the modes that need remote updates. S6 flips this on with Realtime.
   */
  readonly supportsRealtime: boolean;

  createSession(options: CreateSessionOptions): Promise<CreatedSession>;
  joinSession(roomCode: string, displayName?: string): Promise<JoinedSession>;

  getState(sessionId: string): Promise<GameState>;
  /** TIREUR only. A Découvreur screen must never call this. */
  getMySecret(sessionId: string): Promise<Secret>;

  ask(sessionId: string): Promise<GameState>;
  answer(sessionId: string, answerLabel: string): Promise<GameState>;
  guess(sessionId: string, name: string): Promise<GameState>;
  confirmGuess(sessionId: string, answerLabel: string): Promise<GameState>;
  goBack(sessionId: string, stepIndex: number): Promise<GameState>;
  rewind(sessionId: string, count: 1 | 2 | 3): Promise<GameState>;
  aiDecouvreurStep(sessionId: string): Promise<GameState>;
  abandon(sessionId: string): Promise<GameState>;

  getRevealedPath(sessionId: string): Promise<RevealedPath>;
  listNames(graphSlug: string): Promise<string[]>;

  /**
   * Optional push channel. Returns an unsubscribe function. The default
   * implementations return a no-op; S6 implements it with `postgres_changes` on
   * `game_sessions` / `game_moves` / `game_players` and calls back with no
   * arguments so the hook refetches through `getState`.
   */
  subscribe?(sessionId: string, onChange: () => void): () => void;
}
