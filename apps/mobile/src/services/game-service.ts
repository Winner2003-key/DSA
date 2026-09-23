import type { RealtimeStatus } from './realtime-sync';
import type {
  BookSection,
  CreateSessionOptions,
  CreatedSession,
  GameState,
  JoinedSession,
  RematchSession,
  RevealedPath,
  Secret,
  SolutionPath,
  TimerDefaults,
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

  /** TIREUR: "Je suis prêt" — the preparation phase ends and the game time starts. */
  tireurReady(sessionId: string): Promise<GameState>;
  /**
   * TIREUR: "Changer de nom", only during the preparation phase. Draws another
   * card (never one already drawn in this game) and, in a timed game, gives a
   * fresh thinking time. Throws `GAME_STARTED` once the questions have begun and
   * `NO_REDRAW_LEFT` after `settings.max_redraws`.
   */
  redrawSecret(sessionId: string): Promise<GameState>;
  /**
   * Lets an idle client turn a game whose time has run out into `TIME_UP`. The
   * server decides; this never raises `TIME_UP`, it just returns the new state.
   */
  checkTime(sessionId: string): Promise<GameState>;
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

  /**
   * The durations "Préparer la partie" promises under the chronometer checkbox.
   * They are the admin's current Réglages, not a running game's snapshot.
   */
  getTimerDefaults(): Promise<TimerDefaults>;

  /**
   * The book's sections, for the « Choisir une partie » picker: label, parent,
   * depth and how many names each holds. Never a name, a clue or a leaf, so the
   * picker shows no more than the book's table of contents.
   */
  listSections(graphSlug: string): Promise<BookSection[]>;

  getRevealedPath(sessionId: string): Promise<RevealedPath>;
  /** The book's own path to the name. Only once the game is over. */
  getSolutionPath(sessionId: string): Promise<SolutionPath>;
  listNames(graphSlug: string): Promise<string[]>;

  /**
   * Push channel for one session. `onChange` is called (debounced, with no payload)
   * whenever the session, its players or its moves change, so the hook refetches
   * through `getState`. `onStatus` reports the channel; while it is not
   * `SUBSCRIBED` the subscription polls instead. Returns the unsubscribe function.
   */
  subscribe?(sessionId: string, onChange: () => void, onStatus?: (status: RealtimeStatus) => void): () => void;
}
