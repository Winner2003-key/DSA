import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GameEngine,
  GraphIndex,
  NO_CLOCK,
  answerClass,
  currentPrompt,
  decisionEdgeFor,
  derivePosition,
  endThinking,
  hasHomonyms,
  phaseOf,
  restartThinking,
  solutionPath,
  startPlay,
  tick,
  type ClockSettings,
  type ClockState,
  type EngineState,
  type GameMode,
  type GraphData,
  type PathStep,
  type Prompt,
  type Role,
} from '@dsa/core';
import miniGraph from '@dsa/core/fixtures/mini-graph.json';

import { DsaError, toDsaError } from './errors';
import type { GameService } from './game-service';
import {
  DEFAULT_SETTINGS,
  type CreateSessionOptions,
  type CreatedSession,
  type GameSettings,
  type GameState,
  type JoinedSession,
  type PathEntry,
  type RematchSession,
  type RevealedPath,
  type Secret,
  type SolutionPath,
  type StatePlayer,
  type TimerDefaults,
} from './types';

const STORAGE_KEY = 'dsa.offline.sessions';

/** Mirrors the single `app_settings` row the admin edits. */
export interface OfflineAppSettings {
  thinkSeconds: number;
  playSeconds: number;
  maxRedraws: number;
}

export const OFFLINE_APP_SETTINGS: OfflineAppSettings = { thinkSeconds: 40, playSeconds: 120, maxRedraws: 2 };

export interface OfflineGameServiceOptions {
  /** Defaults to the mini graph fixture shipped with `@dsa/core`. */
  graph?: GraphData;
  /** Keep games across a reload. Off in tests. */
  persist?: boolean;
  /** Test seam: always draw this card instead of a random one. */
  secretNodeKey?: string;
  /** Test seam: the clock the timer runs on. Defaults to the real one. */
  now?: () => string;
  /** Test seam: what the admin's Réglages page would hold. */
  appSettings?: Partial<OfflineAppSettings>;
}

interface OfflineSession {
  id: string;
  roomCode: string;
  mode: GameMode;
  displayName: string;
  state: EngineState;
  settings: GameSettings;
  /** The clock of a timed game; all-null when there is none. */
  clock: ClockState;
  /** Cards already drawn in this game. Never leaves the service. */
  previousSecrets: string[];
}

/**
 * Mirrors `dsa_normalize_settings`: a client may send `input_mode` (VOICE or
 * BUTTONS, default BUTTONS) and `timed` (default false), and nothing else. The
 * durations and `max_redraws` are copied from the app settings, so a running
 * game keeps them whatever the admin does afterwards.
 */
export function normalizeSettings(raw: unknown, app: OfflineAppSettings = OFFLINE_APP_SETTINGS): GameSettings {
  const value = raw ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new DsaError('INVALID_SETTINGS', 'settings must be an object');
  const unknown = Object.keys(value).filter((key) => key !== 'input_mode' && key !== 'timed');
  if (unknown.length > 0) throw new DsaError('INVALID_SETTINGS', `unknown setting(s): ${unknown.join(', ')}`);

  const mode = (value as { input_mode?: unknown }).input_mode ?? null;
  if (mode !== null && mode !== 'VOICE' && mode !== 'BUTTONS') {
    throw new DsaError('INVALID_SETTINGS', 'input_mode must be VOICE or BUTTONS');
  }
  const timed = (value as { timed?: unknown }).timed ?? false;
  if (typeof timed !== 'boolean') throw new DsaError('INVALID_SETTINGS', 'timed must be true or false');

  return {
    input_mode: mode ?? DEFAULT_SETTINGS.input_mode,
    timed,
    think_seconds: timed ? app.thinkSeconds : null,
    play_seconds: timed ? app.playSeconds : null,
    max_redraws: app.maxRedraws,
  };
}

function randomId(): string {
  const part = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `offline-${part()}${part()}`;
}

function randomRoomCode(): string {
  return `DSA-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Plays a whole game on the device with `@dsa/core` and the mini graph fixture:
 * no Supabase, no network, no account. Enabled by EXPO_PUBLIC_DSA_OFFLINE=1 only,
 * for development and for demoing without a server.
 *
 * It reproduces the RPC contract exactly — the same state JSON, the same role and
 * awaiting checks, the same `DSA_` error codes — so the UI above it cannot tell
 * which implementation it is talking to.
 */
export class OfflineGameService implements GameService {
  readonly offline = true;
  readonly supportsRealtime = true; // Everything happens in-process; nothing to poll.

  private readonly index: GraphIndex;
  private readonly engine: GameEngine;
  private readonly sessions = new Map<string, OfflineSession>();
  private restored: Promise<void> | null = null;
  private readonly persist: boolean;

  private readonly secretNodeKey: string | null;
  private readonly now: () => string;
  readonly appSettings: OfflineAppSettings;

  constructor(options: OfflineGameServiceOptions = {}) {
    this.index = new GraphIndex((options.graph ?? (miniGraph as unknown as GraphData)) as GraphData);
    this.now = options.now ?? (() => new Date().toISOString());
    this.engine = new GameEngine(this.index, { now: this.now });
    this.persist = options.persist ?? true;
    this.secretNodeKey = options.secretNodeKey ?? null;
    this.appSettings = { ...OFFLINE_APP_SETTINGS, ...options.appSettings };
  }

  /** The clock rules of one session, as `@dsa/core` states them. */
  private static clockSettings(session: OfflineSession): ClockSettings {
    return {
      timed: session.settings.timed,
      thinkSeconds: session.settings.think_seconds ?? OFFLINE_APP_SETTINGS.thinkSeconds,
      playSeconds: session.settings.play_seconds ?? OFFLINE_APP_SETTINGS.playSeconds,
    };
  }

  /**
   * Mirrors `dsa_tick`: applies the deadlines at this instant. The thinking
   * phase ends at its own deadline, so the game time is the same length however
   * long the Tireur took; then the game may be out of time.
   */
  private tick(session: OfflineSession): OfflineSession {
    if (session.state.status !== 'PLAYING') return session;
    const at = this.now();
    const { clock, timeUp, endedAt } = tick(session.clock, OfflineGameService.clockSettings(session), at);
    session.clock = clock;
    if (timeUp) {
      session.state = { ...session.state, status: 'TIME_UP', awaiting: 'NONE', pendingGuess: null, endedAt };
      this.sessions.set(session.id, session);
      this.save();
    }
    return session;
  }

  /** Mirrors `dsa_assert_time`: no move ever lands after the limit. */
  private static assertTime(session: OfflineSession): void {
    if (session.state.status === 'TIME_UP') throw new DsaError('TIME_UP');
  }

  /**
   * Mirrors `dsa_assert_tireur_ready`: every mode with a human Tireur starts in
   * the preparation phase, and nobody plays until it is over.
   */
  private static assertTireurReady(session: OfflineSession): void {
    if (session.state.status === 'PLAYING' && session.mode !== 'AI_TIREUR' && session.clock.readyAt === null) {
      throw new DsaError('TIREUR_NOT_READY');
    }
  }

  /** The three checks every mutating call makes, in the server's order. */
  private guard(session: OfflineSession, options: { needsReady?: boolean } = {}): OfflineSession {
    const ticked = this.tick(session);
    OfflineGameService.assertTime(ticked);
    if (options.needsReady) OfflineGameService.assertTireurReady(ticked);
    return ticked;
  }

  /** The card this game draws: a fixed one in tests, otherwise a random playable one. */
  private newGame(): EngineState {
    if (this.secretNodeKey === null) return this.engine.newGame();
    const node = this.index.nodeByKey(this.secretNodeKey);
    if (!node) throw new DsaError('NO_PLAYABLE_SECRET', `unknown node key ${this.secretNodeKey}`);
    return this.engine.newGame(node.id);
  }

  // ---- storage ---------------------------------------------------------------

  private async restore(): Promise<void> {
    if (!this.persist) return;
    if (!this.restored) {
      this.restored = AsyncStorage.getItem(STORAGE_KEY)
        .then((raw) => {
          if (!raw) return;
          const parsed = JSON.parse(raw) as OfflineSession[];
          for (const session of parsed) if (!this.sessions.has(session.id)) this.sessions.set(session.id, session);
        })
        .catch(() => undefined);
    }
    await this.restored;
  }

  private save(): void {
    if (!this.persist) return;
    // Keep the last few games only; this store exists so a web reload doesn't
    // lose the running demo, not as a history.
    const recent = [...this.sessions.values()].slice(-5);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recent)).catch(() => undefined);
  }

  private async session(sessionId: string): Promise<OfflineSession> {
    await this.restore();
    const session = this.sessions.get(sessionId);
    if (!session) throw new DsaError('SESSION_NOT_FOUND');
    return session;
  }

  // ---- roles -----------------------------------------------------------------

  private static myRoles(mode: GameMode): Role[] {
    switch (mode) {
      case 'LOCAL':
        return ['TIREUR', 'DECOUVREUR'];
      case 'AI_TIREUR':
        return ['DECOUVREUR'];
      case 'AI_DECOUVREUR':
        return ['TIREUR'];
      default:
        return ['TIREUR', 'DECOUVREUR'];
    }
  }

  private static players(session: OfflineSession): StatePlayer[] {
    const mine = OfflineGameService.myRoles(session.mode);
    const build = (role: Role): StatePlayer => {
      const isMine = mine.includes(role);
      return {
        role,
        display_name: isMine ? session.displayName : 'IA',
        is_ai: !isMine,
        is_me: isMine,
      };
    };
    return [build('TIREUR'), build('DECOUVREUR')];
  }

  private requireRole(session: OfflineSession, role: Role): void {
    if (!OfflineGameService.myRoles(session.mode).includes(role)) throw new DsaError('WRONG_ROLE');
  }

  // ---- state JSON ------------------------------------------------------------

  private promptOf(state: EngineState): Prompt | null {
    return currentPrompt(this.index, derivePosition(this.index, state.steps));
  }

  private pathOf(state: EngineState): PathEntry[] {
    return OfflineGameService.toEntries(this.engine.revealedPath(state));
  }

  private toState(session: OfflineSession): GameState {
    const { state } = session;
    const playing = state.status === 'PLAYING';
    const prompt = playing ? this.promptOf(state) : null;
    return {
      status: state.status,
      mode: session.mode,
      awaiting: state.awaiting,
      prompt: prompt
        ? {
            node_id: prompt.promptNodeId,
            text: prompt.text,
            node_type: this.index.requireNode(prompt.promptNodeId).nodeType,
            answer_classes: [...prompt.answerClasses],
          }
        : null,
      dead_end: playing && prompt === null && this.engine.isDeadEnd(state),
      pending_guess: state.pendingGuess,
      path: this.pathOf(state),
      players: OfflineGameService.players(session),
      settings: session.settings ?? { ...DEFAULT_SETTINGS },
      tireur_ready: session.clock.readyAt !== null,
      room_code: session.roomCode,
      timed: session.settings.timed,
      phase: phaseOf(session.clock),
      think_ends_at: session.clock.thinkEndsAt,
      play_ends_at: session.clock.playEndsAt,
      server_now: this.now(),
      redraws_used: session.previousSecrets.length,
      redraws_left: Math.max(0, session.settings.max_redraws - session.previousSecrets.length),
    };
  }

  /** Mirrors `dsa_canonical_label`: the path records the book's own spelling. */
  private canonicalLabel(state: EngineState, label: string): string {
    const prompt = this.promptOf(state);
    if (!prompt) return label;
    if (prompt.kind === 'CHILD') return answerClass(label) === 'OUI' ? 'OUI' : 'NON';
    return decisionEdgeFor(this.index, prompt, label)?.answerLabel ?? label;
  }

  private commit(session: OfflineSession, state: EngineState): GameState {
    session.state = state;
    this.sessions.set(session.id, session);
    this.save();
    return this.toState(session);
  }

  // ---- GameService -----------------------------------------------------------

  async createSession(options: CreateSessionOptions): Promise<CreatedSession> {
    await this.restore();
    const settings = normalizeSettings(options.settings, this.appSettings);
    try {
      // Only the AI Tireur has no card to look at; every other mode starts in
      // the preparation phase, exactly as the server does it.
      const readyAtOnce = options.mode === 'AI_TIREUR';
      const session: OfflineSession = {
        id: randomId(),
        roomCode: randomRoomCode(),
        mode: options.mode,
        displayName: options.displayName ?? 'Toi',
        state: this.newGame(),
        settings,
        clock: startPlay(
          { timed: settings.timed, thinkSeconds: settings.think_seconds ?? this.appSettings.thinkSeconds, playSeconds: settings.play_seconds ?? this.appSettings.playSeconds },
          this.now(),
          readyAtOnce,
        ),
        previousSecrets: [],
      };
      this.sessions.set(session.id, session);
      this.save();
      return { sessionId: session.id, roomCode: session.roomCode };
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async joinSession(): Promise<JoinedSession> {
    // Rooms need a server; the offline service only plays LOCAL and the AI modes.
    throw new DsaError('ROOM_NOT_FOUND');
  }

  async getState(sessionId: string): Promise<GameState> {
    return this.toState(await this.session(sessionId));
  }

  async getMySecret(sessionId: string): Promise<Secret> {
    const session = await this.session(sessionId);
    this.requireRole(session, 'TIREUR');
    const secretNodeId = session.state.secretNodeId;
    if (secretNodeId === null) throw new DsaError('UNKNOWN', 'no secret in this game');
    return this.secretOf(secretNodeId);
  }

  private secretOf(secretNodeId: string): Secret {
    const node = this.index.requireNode(secretNodeId);
    const character = this.index.characterOf(node.id);
    return {
      node_id: node.id,
      name: node.label,
      description: character?.description ?? node.description,
      has_homonyms: hasHomonyms(this.index, node.id),
    };
  }

  async tireurReady(sessionId: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    this.requireRole(session, 'TIREUR');
    if (session.state.status !== 'PLAYING') throw new DsaError('GAME_OVER');
    if (session.clock.readyAt === null) {
      session.clock = endThinking(session.clock, OfflineGameService.clockSettings(session), this.now());
      this.sessions.set(session.id, session);
      this.save();
    }
    return this.toState(session);
  }

  async redrawSecret(sessionId: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    this.requireRole(session, 'TIREUR');
    if (session.state.status !== 'PLAYING') throw new DsaError('GAME_OVER');

    // Only while the Tireur still holds the card: once the questions have
    // started the name is fixed, and only abandoning is left.
    if (session.clock.readyAt !== null || session.state.steps.length > 0 || session.state.moves.length > 1) {
      throw new DsaError('GAME_STARTED');
    }
    if (session.previousSecrets.length >= session.settings.max_redraws) throw new DsaError('NO_REDRAW_LEFT');

    const current = session.state.secretNodeId;
    const drawn = new Set([...session.previousSecrets, ...(current ? [current] : [])]);
    const candidates = this.index.playableCharacters().filter((node) => !drawn.has(node.id));
    if (candidates.length === 0) throw new DsaError('NO_PLAYABLE_SECRET');
    const next = candidates[Math.floor(Math.random() * candidates.length)] as (typeof candidates)[number];

    if (current) session.previousSecrets = [...session.previousSecrets, current];
    session.state = { ...session.state, secretNodeId: next.id };
    // A new card deserves a fresh thinking time, and never more game time.
    session.clock = restartThinking(session.clock, OfflineGameService.clockSettings(session), this.now());
    this.sessions.set(session.id, session);
    this.save();
    return this.toState(session);
  }

  async checkTime(sessionId: string): Promise<GameState> {
    return this.toState(this.tick(await this.session(sessionId)));
  }

  async rematch(): Promise<RematchSession> {
    // Rooms between two devices need the server.
    throw new DsaError('WRONG_MODE');
  }

  async ask(sessionId: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId), { needsReady: true });
    this.requireRole(session, 'DECOUVREUR');
    try {
      let next = this.engine.ask(session.state);
      // AI_TIREUR answers in the same call, exactly like `dsa_ask` does.
      if (session.mode === 'AI_TIREUR') next = this.engine.answer(next, this.engine.aiTireurAnswer(next));
      return this.commit(session, next);
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async answer(sessionId: string, answerLabel: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    this.requireRole(session, 'TIREUR');
    try {
      const label = this.canonicalLabel(session.state, answerLabel);
      return this.commit(session, this.engine.answer(session.state, label));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async guess(sessionId: string, name: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId), { needsReady: true });
    this.requireRole(session, 'DECOUVREUR');
    if (name.trim().length === 0 || name.length > 120) throw new DsaError('INVALID_NAME');
    try {
      let next = this.engine.guess(session.state, name);
      if (session.mode === 'AI_TIREUR') {
        next = this.engine.confirmGuess(next, this.engine.aiTireurAnswer(next) === 'OUI' ? 'OUI' : 'NON');
      }
      return this.commit(session, next);
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async confirmGuess(sessionId: string, answerLabel: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    this.requireRole(session, 'TIREUR');
    const cls = answerClass(answerLabel);
    if (cls !== 'OUI' && cls !== 'NON') throw new DsaError('ANSWER_NOT_ALLOWED');
    try {
      return this.commit(session, this.engine.confirmGuess(session.state, cls));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async goBack(sessionId: string, stepIndex: number): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    this.requireRole(session, 'DECOUVREUR');
    try {
      return this.commit(session, this.engine.goBack(session.state, stepIndex));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async rewind(sessionId: string, count: 1 | 2 | 3): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    this.requireRole(session, 'TIREUR');
    try {
      return this.commit(session, this.engine.rewind(session.state, count));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async aiDecouvreurStep(sessionId: string): Promise<GameState> {
    const session = await this.session(sessionId);
    this.requireRole(session, 'TIREUR');
    if (session.mode !== 'AI_DECOUVREUR') throw new DsaError('WRONG_MODE');
    this.guard(session, { needsReady: true });
    try {
      const action = this.engine.aiDecouvreurAction(session.state);
      switch (action.type) {
        case 'ASK':
          return this.commit(session, this.engine.ask(session.state));
        case 'GUESS':
          return this.commit(session, this.engine.guess(session.state, action.name));
        case 'BACK':
          return this.commit(session, this.engine.goBack(session.state, action.stepIndex));
      }
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async abandon(sessionId: string): Promise<GameState> {
    const session = this.guard(await this.session(sessionId));
    try {
      return this.commit(session, this.engine.abandon(session.state));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async getRevealedPath(sessionId: string): Promise<RevealedPath> {
    const session = await this.session(sessionId);
    const { state } = session;
    let secret: Secret | null = null;
    if (OfflineGameService.isOver(state.status) && state.secretNodeId !== null) secret = this.secretOf(state.secretNodeId);
    const stats = this.engine.stats(state);
    // From the start of the game phase to the discovery, like the server's
    // ended_at − tireur_ready_at.
    const found =
      state.status === 'DISCOVERED' && session.clock.readyAt !== null && state.endedAt !== null
        ? Math.max(0, Math.round((Date.parse(state.endedAt) - Date.parse(session.clock.readyAt)) / 1000))
        : null;
    return {
      status: state.status,
      winner: state.status === 'DISCOVERED' ? 'DECOUVREUR' : null,
      path: this.pathOf(state),
      stats: {
        questions: stats.questions,
        non: stats.nonAnswers,
        backs: stats.backs,
        rewinds: stats.rewinds,
        timed: session.settings.timed,
        play_seconds: session.settings.timed ? session.settings.play_seconds : null,
        found_in_seconds: found,
      },
      secret,
    };
  }

  private static isOver(status: EngineState['status']): boolean {
    return status === 'DISCOVERED' || status === 'ABANDONED' || status === 'TIME_UP';
  }

  async getTimerDefaults(): Promise<TimerDefaults> {
    return {
      think_seconds: this.appSettings.thinkSeconds,
      play_seconds: this.appSettings.playSeconds,
      max_redraws: this.appSettings.maxRedraws,
    };
  }

  async getSolutionPath(sessionId: string): Promise<SolutionPath> {
    const session = await this.session(sessionId);
    const { state } = session;
    if (!OfflineGameService.isOver(state.status)) throw new DsaError('GAME_NOT_OVER');
    const secretNodeId = state.secretNodeId;
    return {
      status: state.status,
      path: secretNodeId === null ? [] : OfflineGameService.toEntries(solutionPath(this.index, secretNodeId)),
      secret: secretNodeId === null ? null : this.secretOf(secretNodeId),
    };
  }

  /** Core `PathStep`s as the `path[]` entries every client already knows. */
  private static toEntries(steps: PathStep[]): PathEntry[] {
    return steps.flatMap((step) =>
      step.kind === 'STEP'
        ? [
            {
              step_index: step.index,
              node_id: step.promptNodeId,
              text: step.text,
              answer_label: step.answerLabel,
              prompt_kind: step.promptKind,
              node_type: step.nodeType,
              target_text: step.targetText,
            },
          ]
        : [],
    );
  }

  async listNames(): Promise<string[]> {
    const names = new Set<string>();
    for (const node of this.index.nodes()) if (node.nodeType === 'CHARACTER') names.add(node.label);
    for (const character of this.index.data.characters) {
      names.add(character.name);
      for (const alias of character.aliases) names.add(alias);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'fr'));
  }
}
