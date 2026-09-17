import type { GameService } from './game-service';
import { DsaError, toDsaError } from './errors';
import { createGameSubscription, type OpenChannel, type RealtimeStatus } from './realtime-sync';
import { ensureRealtimeAuth, ensureSignedIn, getSupabase } from './supabase';
import {
  DEFAULT_SETTINGS,
  type CreateSessionOptions,
  type CreatedSession,
  type GameSettings,
  type GameState,
  type GameStats,
  type JoinedSession,
  type PathEntry,
  type RematchSession,
  type RevealedPath,
  type Secret,
  type StatePlayer,
  type StatePrompt,
} from './types';

/**
 * The slice of `supabase-js` this service uses. Table-returning RPCs come back as
 * a one-row array, so nothing here needs the query builder — which also makes the
 * service trivially mockable in tests.
 */
export interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface SupabaseGameServiceOptions {
  client?: RpcClient;
  /** Runs before every call. Defaults to anonymous sign-in. */
  ensureAuth?: () => Promise<void>;
  /** Opens the push channel of one session. Defaults to Supabase Realtime (tests inject a fake). */
  openChannel?: (sessionId: string) => OpenChannel;
}

let channelCounter = 0;

/**
 * `postgres_changes` on the three published game tables, filtered to one session.
 * Realtime applies the SELECT policies, so only players of the session get events.
 * Each subscription gets its own topic: supabase-js hands back an existing channel
 * with the same topic, which would still be closing after a resubscribe.
 */
export function supabaseGameChannel(sessionId: string): OpenChannel {
  return ({ onEvent, onStatus }) => {
    let closed = false;
    let remove: (() => void) | null = null;

    ensureRealtimeAuth()
      .then((supabase) => {
        if (closed) return;
        channelCounter += 1;
        const channel = supabase
          .channel(`game:${sessionId}:${channelCounter}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` }, onEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_moves', filter: `game_session_id=eq.${sessionId}` }, onEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_session_id=eq.${sessionId}` }, onEvent)
          .subscribe((status) => onStatus(status as Parameters<typeof onStatus>[0]));
        remove = () => {
          void supabase.removeChannel(channel);
        };
      })
      .catch(() => {
        if (!closed) onStatus('CHANNEL_ERROR');
      });

    return {
      close: () => {
        closed = true;
        remove?.();
      },
    };
  };
}

/** Row shapes returned by the table-returning RPCs. */
interface CreateSessionRow {
  session_id: string;
  room_code: string;
}
interface JoinSessionRow {
  session_id: string;
  role: 'TIREUR' | 'DECOUVREUR';
}
interface SecretRow {
  node_id: string;
  name: string;
  description: string | null;
  has_homonyms?: boolean | null;
}

/** Path entries, tolerating a server that predates 03_game_ux.sql (no kind/type/target). */
function asPath(raw: unknown): PathEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: Partial<PathEntry>) => {
    const nodeType = entry.node_type ?? 'QUESTION';
    return {
      step_index: Number(entry.step_index ?? 0),
      node_id: String(entry.node_id ?? ''),
      text: String(entry.text ?? ''),
      answer_label: String(entry.answer_label ?? ''),
      prompt_kind: entry.prompt_kind ?? (entry.node_type === undefined || nodeType === 'QUESTION' ? 'SPINE' : 'CHILD'),
      node_type: nodeType,
      target_text: entry.target_text ?? null,
    };
  });
}

function asSettings(raw: unknown): GameSettings {
  const mode = raw && typeof raw === 'object' ? (raw as { input_mode?: unknown }).input_mode : undefined;
  return { input_mode: mode === 'VOICE' ? 'VOICE' : DEFAULT_SETTINGS.input_mode };
}

function asStats(raw: unknown): GameStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : 0);
  return { questions: n('questions'), non: n('non'), backs: n('backs'), rewinds: n('rewinds') };
}

function asSecret(raw: Partial<SecretRow> | null | undefined): Secret | null {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') return null;
  return {
    node_id: String(raw.node_id ?? ''),
    name: raw.name,
    description: raw.description ?? null,
    has_homonyms: raw.has_homonyms === true,
  };
}

export class SupabaseGameService implements GameService {
  readonly offline = false;
  readonly supportsRealtime = true;

  private readonly injectedClient: RpcClient | null;
  private readonly ensureAuth: () => Promise<void>;
  private readonly openChannel: (sessionId: string) => OpenChannel;

  constructor(options: SupabaseGameServiceOptions = {}) {
    this.injectedClient = options.client ?? null;
    this.ensureAuth = options.ensureAuth ?? ensureSignedIn;
    this.openChannel = options.openChannel ?? supabaseGameChannel;
  }

  subscribe(sessionId: string, onChange: () => void, onStatus?: (status: RealtimeStatus) => void): () => void {
    const subscription = createGameSubscription({ open: this.openChannel(sessionId), onChange, onStatus });
    return () => subscription.close();
  }

  private client(): RpcClient {
    return this.injectedClient ?? (getSupabase() as unknown as RpcClient);
  }

  /** Signs in if needed, calls the RPC, and turns `DSA_<CODE>: …` into a DsaError. */
  private async call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    try {
      await this.ensureAuth();
    } catch (error) {
      throw toDsaError(error);
    }

    let result: { data: unknown; error: { message: string } | null };
    try {
      result = await this.client().rpc(fn, args);
    } catch (error) {
      throw toDsaError(error);
    }
    if (result.error) throw toDsaError(result.error);
    return result.data;
  }

  /** Table-returning RPCs return an array with one row (DATABASE_SCHEMA.md §3). */
  private static firstRow<T>(data: unknown, fn: string): T {
    const row = Array.isArray(data) ? data[0] : data;
    if (row === undefined || row === null) throw new DsaError('UNKNOWN', `${fn} returned no row`);
    return row as T;
  }

  private static asState(data: unknown): GameState {
    const raw = (Array.isArray(data) ? data[0] : data) as Partial<GameState> | null | undefined;
    if (!raw || typeof raw !== 'object' || typeof raw.status !== 'string') {
      throw new DsaError('UNKNOWN', 'the server returned an unreadable state');
    }
    return {
      status: raw.status,
      mode: raw.mode as GameState['mode'],
      awaiting: raw.awaiting as GameState['awaiting'],
      prompt: (raw.prompt ?? null) as StatePrompt | null,
      dead_end: raw.dead_end === true,
      pending_guess: raw.pending_guess ?? null,
      path: asPath(raw.path),
      players: (raw.players ?? []) as StatePlayer[],
      settings: asSettings(raw.settings),
      // A server that predates 05_rooms.sql has no ready phase: treat it as ready.
      tireur_ready: raw.tireur_ready !== false,
      room_code: typeof raw.room_code === 'string' ? raw.room_code : null,
    };
  }

  async createSession(options: CreateSessionOptions): Promise<CreatedSession> {
    const data = await this.call('dsa_create_session', {
      p_graph_slug: options.graphSlug,
      p_mode: options.mode,
      p_role: options.role ?? null,
      p_display_name: options.displayName ?? null,
      p_settings: { ...DEFAULT_SETTINGS, ...options.settings },
    });
    const row = SupabaseGameService.firstRow<CreateSessionRow>(data, 'dsa_create_session');
    return { sessionId: row.session_id, roomCode: row.room_code };
  }

  async joinSession(roomCode: string, displayName?: string): Promise<JoinedSession> {
    const data = await this.call('dsa_join_session', {
      p_room_code: roomCode,
      p_display_name: displayName ?? null,
    });
    const row = SupabaseGameService.firstRow<JoinSessionRow>(data, 'dsa_join_session');
    return { sessionId: row.session_id, role: row.role };
  }

  async getState(sessionId: string): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_get_state', { p_session_id: sessionId }));
  }

  async getMySecret(sessionId: string): Promise<Secret> {
    const data = await this.call('dsa_get_my_secret', { p_session_id: sessionId });
    const row = asSecret(SupabaseGameService.firstRow<SecretRow>(data, 'dsa_get_my_secret'));
    if (!row) throw new DsaError('UNKNOWN', 'dsa_get_my_secret returned an unreadable row');
    return row;
  }

  async tireurReady(sessionId: string): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_tireur_ready', { p_session_id: sessionId }));
  }

  async rematch(sessionId: string, swapRoles: boolean): Promise<RematchSession> {
    const data = await this.call('dsa_rematch', { p_session_id: sessionId, p_swap_roles: swapRoles });
    const row = SupabaseGameService.firstRow<{ session_id: string; room_code: string; role: 'TIREUR' | 'DECOUVREUR' }>(
      data,
      'dsa_rematch',
    );
    return { sessionId: row.session_id, roomCode: row.room_code, role: row.role };
  }

  async ask(sessionId: string): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_ask', { p_session_id: sessionId }));
  }

  async answer(sessionId: string, answerLabel: string): Promise<GameState> {
    return SupabaseGameService.asState(
      await this.call('dsa_answer', { p_session_id: sessionId, p_answer_label: answerLabel }),
    );
  }

  async guess(sessionId: string, name: string): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_guess', { p_session_id: sessionId, p_name: name }));
  }

  async confirmGuess(sessionId: string, answerLabel: string): Promise<GameState> {
    return SupabaseGameService.asState(
      await this.call('dsa_confirm_guess', { p_session_id: sessionId, p_answer_label: answerLabel }),
    );
  }

  async goBack(sessionId: string, stepIndex: number): Promise<GameState> {
    return SupabaseGameService.asState(
      await this.call('dsa_go_back', { p_session_id: sessionId, p_step_index: stepIndex }),
    );
  }

  async rewind(sessionId: string, count: 1 | 2 | 3): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_rewind', { p_session_id: sessionId, p_count: count }));
  }

  async aiDecouvreurStep(sessionId: string): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_ai_decouvreur_step', { p_session_id: sessionId }));
  }

  async abandon(sessionId: string): Promise<GameState> {
    return SupabaseGameService.asState(await this.call('dsa_abandon', { p_session_id: sessionId }));
  }

  async getRevealedPath(sessionId: string): Promise<RevealedPath> {
    const data = (await this.call('dsa_get_revealed_path', { p_session_id: sessionId })) as
      | Partial<RevealedPath>
      | null;
    if (!data || typeof data !== 'object') throw new DsaError('UNKNOWN', 'dsa_get_revealed_path returned nothing');
    return {
      status: (data.status ?? 'PLAYING') as RevealedPath['status'],
      winner: data.winner ?? null,
      path: asPath(data.path),
      stats: asStats(data.stats),
      secret: asSecret(data.secret as Partial<SecretRow> | null),
    };
  }

  async listNames(graphSlug: string): Promise<string[]> {
    const data = await this.call('dsa_list_names', { p_graph_slug: graphSlug });
    return Array.isArray(data) ? (data.filter((n) => typeof n === 'string') as string[]) : [];
  }
}
