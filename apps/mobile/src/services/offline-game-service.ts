import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GameEngine,
  GraphIndex,
  answerClass,
  currentPrompt,
  decisionEdgeFor,
  derivePosition,
  hasHomonyms,
  type EngineState,
  type GameMode,
  type GraphData,
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
  type RevealedPath,
  type Secret,
  type StatePlayer,
} from './types';

const STORAGE_KEY = 'dsa.offline.sessions';

export interface OfflineGameServiceOptions {
  /** Defaults to the mini graph fixture shipped with `@dsa/core`. */
  graph?: GraphData;
  /** Keep games across a reload. Off in tests. */
  persist?: boolean;
  /** Test seam: always draw this card instead of a random one. */
  secretNodeKey?: string;
}

interface OfflineSession {
  id: string;
  roomCode: string;
  mode: GameMode;
  displayName: string;
  state: EngineState;
  settings: GameSettings;
}

/** Mirrors `dsa_normalize_settings`: only `input_mode`, VOICE or BUTTONS, default BUTTONS. */
export function normalizeSettings(raw: unknown): GameSettings {
  const value = raw ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new DsaError('INVALID_SETTINGS', 'settings must be an object');
  const unknown = Object.keys(value).filter((key) => key !== 'input_mode');
  if (unknown.length > 0) throw new DsaError('INVALID_SETTINGS', `unknown setting(s): ${unknown.join(', ')}`);
  const mode = (value as { input_mode?: unknown }).input_mode;
  if (mode === undefined || mode === null) return { ...DEFAULT_SETTINGS };
  if (mode !== 'VOICE' && mode !== 'BUTTONS') throw new DsaError('INVALID_SETTINGS', 'input_mode must be VOICE or BUTTONS');
  return { input_mode: mode };
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

  constructor(options: OfflineGameServiceOptions = {}) {
    this.index = new GraphIndex((options.graph ?? (miniGraph as unknown as GraphData)) as GraphData);
    this.engine = new GameEngine(this.index);
    this.persist = options.persist ?? true;
    this.secretNodeKey = options.secretNodeKey ?? null;
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
    const entries: PathEntry[] = [];
    for (const step of this.engine.revealedPath(state)) {
      if (step.kind !== 'STEP') continue;
      entries.push({
        step_index: step.index,
        node_id: step.promptNodeId,
        text: step.text,
        answer_label: step.answerLabel,
        prompt_kind: step.promptKind,
        node_type: step.nodeType,
        target_text: step.targetText,
      });
    }
    return entries;
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
    const settings = normalizeSettings(options.settings);
    try {
      const session: OfflineSession = {
        id: randomId(),
        roomCode: randomRoomCode(),
        mode: options.mode,
        displayName: options.displayName ?? 'Toi',
        state: this.newGame(),
        settings,
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

  async ask(sessionId: string): Promise<GameState> {
    const session = await this.session(sessionId);
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
    const session = await this.session(sessionId);
    this.requireRole(session, 'TIREUR');
    try {
      const label = this.canonicalLabel(session.state, answerLabel);
      return this.commit(session, this.engine.answer(session.state, label));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async guess(sessionId: string, name: string): Promise<GameState> {
    const session = await this.session(sessionId);
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
    const session = await this.session(sessionId);
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
    const session = await this.session(sessionId);
    this.requireRole(session, 'DECOUVREUR');
    try {
      return this.commit(session, this.engine.goBack(session.state, stepIndex));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async rewind(sessionId: string, count: 1 | 2 | 3): Promise<GameState> {
    const session = await this.session(sessionId);
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
    const session = await this.session(sessionId);
    try {
      return this.commit(session, this.engine.abandon(session.state));
    } catch (error) {
      throw toDsaError(error);
    }
  }

  async getRevealedPath(sessionId: string): Promise<RevealedPath> {
    const session = await this.session(sessionId);
    const { state } = session;
    const ended = state.status === 'DISCOVERED' || state.status === 'ABANDONED';
    let secret: Secret | null = null;
    if (ended && state.secretNodeId !== null) secret = this.secretOf(state.secretNodeId);
    const stats = this.engine.stats(state);
    return {
      status: state.status,
      winner: state.status === 'DISCOVERED' ? 'DECOUVREUR' : null,
      path: this.pathOf(state),
      stats: { questions: stats.questions, non: stats.nonAnswers, backs: stats.backs, rewinds: stats.rewinds },
      secret,
    };
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
