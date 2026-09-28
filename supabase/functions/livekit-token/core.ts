// DSA — Edge Function `livekit-token`: all the logic, with fetch and env injected.
// No Deno globals here (except Web Crypto, which every runtime has), so the same
// file runs under vitest. index.ts is the thin Deno.serve wrapper.
//
// A room played with Voix is a live call between the two players
// (GAME_RULES.md "Voix in a room is a call"). This function hands a player a
// short-lived LiveKit access token for their own game, and nothing else: the
// API key and secret never leave Supabase.
//
// POST application/json
//   { session_id: uuid }
// Authorization: Bearer <the signed-in user's access token>   (Verify JWT stays on)
//
// 200 { url, token, ends_at }
// 4xx/5xx { error: 'DSA_CALL_…', message_fr }
//
// Audio only: the token may publish the microphone and subscribe, never publish
// data or video. It expires 60 s after the call's own deadline, so a token can
// never outlive the game it was issued for.
//
// Never log tokens, keys or player names.

/** Room name for a session: LiveKit room names are opaque, and this one is unguessable. */
export const ROOM_PREFIX = 'dsa-';
/** Grace on top of `ends_at`, so a reconnection a second before the end still works. */
export const TOKEN_GRACE_SECONDS = 60;
/** Two phones, and a room that closes itself shortly after the last one leaves. */
export const MAX_PARTICIPANTS = 2;
export const EMPTY_TIMEOUT_SECONDS = 30;
export const ROOM_SERVICE_TIMEOUT_MS = 4_000;

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export type ErrorCode =
  | 'DSA_CALL_BAD_REQUEST'
  | 'DSA_CALL_UNAUTHORIZED'
  | 'DSA_CALL_METHOD_NOT_ALLOWED'
  | 'DSA_CALL_NOT_PLAYER'
  | 'DSA_CALL_WRONG_MODE'
  | 'DSA_CALL_NOT_STARTED'
  | 'DSA_CALL_OVER'
  | 'DSA_CALL_NOT_CONFIGURED'
  | 'DSA_CALL_INTERNAL';

export const ERRORS: Readonly<Record<ErrorCode, { status: number; message_fr: string }>> = {
  DSA_CALL_BAD_REQUEST: { status: 400, message_fr: 'Demande d’appel invalide.' },
  DSA_CALL_UNAUTHORIZED: { status: 401, message_fr: 'Connecte-toi pour appeler.' },
  DSA_CALL_METHOD_NOT_ALLOWED: { status: 405, message_fr: 'Méthode non autorisée.' },
  DSA_CALL_NOT_PLAYER: { status: 403, message_fr: 'Cette partie ne t’appartient pas.' },
  DSA_CALL_WRONG_MODE: { status: 403, message_fr: 'Cette partie ne se joue pas en appel.' },
  DSA_CALL_NOT_STARTED: { status: 403, message_fr: 'L’appel n’a pas encore commencé.' },
  DSA_CALL_OVER: { status: 403, message_fr: 'Le temps d’appel est écoulé.' },
  DSA_CALL_NOT_CONFIGURED: { status: 503, message_fr: 'L’appel n’est pas encore configuré.' },
  DSA_CALL_INTERNAL: { status: 500, message_fr: 'Erreur inattendue du serveur d’appel.' },
};

export interface TokenEnv {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** New-style keys, a JSON dictionary ({"default": "sb_publishable_…"}); used when SUPABASE_ANON_KEY is absent. */
  SUPABASE_PUBLISHABLE_KEYS?: string;
  /** The service role key: reads the session and its players past RLS. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export type LogFields = Record<string, string | number | boolean | null>;

export interface TokenDeps {
  env: TokenEnv;
  fetch: typeof fetch;
  now?: () => number;
  /** Metadata only (status, timings, the step that refused). Never tokens or keys. */
  log?: (event: string, fields: LogFields) => void;
}

export interface TokenResult {
  url: string;
  token: string;
  ends_at: string;
}

// ---------------------------------------------------------------------------
// Responses

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function fail(code: ErrorCode): Response {
  const { status, message_fr } = ERRORS[code];
  return json(status, { error: code, message_fr });
}

// ---------------------------------------------------------------------------
// JWT

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is available in Deno, browsers and Node 18+.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

export interface GrantOptions {
  room: string;
  identity: string;
  name?: string;
  /** Seconds from now. */
  ttlSeconds: number;
  /** A server-side token that may create the room, not join it. */
  admin?: boolean;
}

/**
 * A LiveKit access token, signed by hand: HS256 over `header.payload` with the
 * API secret (docs.livekit.io, "Generating tokens"). A player's token is audio
 * only — `canPublish` with `canPublishSources: ['microphone']`, no data channel,
 * no video — and never carries a room-admin grant.
 */
export async function signAccessToken(apiKey: string, apiSecret: string, grant: GrantOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const video = grant.admin
    ? { roomCreate: true, roomAdmin: true, room: grant.room }
    : {
        room: grant.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canPublishSources: ['microphone'],
      };
  const payload = {
    iss: apiKey,
    sub: grant.identity,
    // A little slack, in case the phone's clock is slightly ahead of LiveKit's.
    nbf: now - 10,
    exp: now + Math.max(30, Math.round(grant.ttlSeconds)),
    ...(grant.name ? { name: grant.name } : {}),
    video,
  };

  const message = `${encodeJson(header)}.${encodeJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return `${message}.${base64url(new Uint8Array(signature))}`;
}

// ---------------------------------------------------------------------------
// Helpers

function anonKeyOf(env: TokenEnv): string | null {
  if (env.SUPABASE_ANON_KEY) return env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_PUBLISHABLE_KEYS) return null;
  try {
    const keys = JSON.parse(env.SUPABASE_PUBLISHABLE_KEYS) as Record<string, unknown>;
    const key = keys.default ?? Object.values(keys)[0];
    return typeof key === 'string' ? key : null;
  } catch {
    return null;
  }
}

/** `wss://…` for the client SDKs, whatever shape the secret was pasted in. */
export function normalizeLiveKitUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  return url;
}

/** The HTTP origin of the LiveKit server, for the RoomService REST API. */
export function httpOriginOf(wsUrl: string): string {
  if (wsUrl.startsWith('wss://')) return `https://${wsUrl.slice('wss://'.length)}`;
  if (wsUrl.startsWith('ws://')) return `http://${wsUrl.slice('ws://'.length)}`;
  return wsUrl;
}

export function roomNameFor(sessionId: string): string {
  return `${ROOM_PREFIX}${sessionId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SessionRow {
  id: string;
  mode: string;
  status: string;
  settings: Record<string, unknown> | null;
  tireur_ready_at: string | null;
  call_ends_at: string | null;
}

interface PlayerRow {
  user_id: string | null;
  role: string;
  is_ai: boolean;
}

/** The only name LiveKit sees: the role, never the player's display name. */
function callNameFor(role: string): string {
  return role === 'TIREUR' ? 'Tireur' : 'Découvreur';
}

/**
 * Creates the room with two seats and a short empty timeout. Best effort: LiveKit
 * also creates a room when its first participant joins, so a failure here is
 * logged and the token is still returned.
 */
async function ensureRoom(deps: TokenDeps, origin: string, adminToken: string, room: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROOM_SERVICE_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${origin}/twirp/livekit.RoomService/CreateRoom`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: room, max_participants: MAX_PARTICIPANTS, empty_timeout: EMPTY_TIMEOUT_SECONDS }),
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

export async function handleLiveKitToken(req: Request, deps: TokenDeps): Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => undefined);
  const started = now();
  const done = (response: Response, fields: LogFields = {}) => {
    log('livekit_token', { status: response.status, ms: now() - started, ...fields });
    return response;
  };

  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'POST') return done(fail('DSA_CALL_METHOD_NOT_ALLOWED'));

  // 1. The caller's own token (verify_jwt checked the signature; resolve the user).
  const authorization = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return done(fail('DSA_CALL_UNAUTHORIZED'), { step: 'header' });

  const env = deps.env;
  const anonKey = anonKeyOf(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !anonKey || !serviceKey) return done(fail('DSA_CALL_NOT_CONFIGURED'), { step: 'supabase_env' });
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return done(fail('DSA_CALL_NOT_CONFIGURED'), { step: 'livekit_env' });
  }
  const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, '');

  let userId: string;
  try {
    const userResponse = await deps.fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
    const user = (await userResponse.json().catch(() => null)) as { id?: unknown } | null;
    if (!userResponse.ok || typeof user?.id !== 'string') {
      return done(fail('DSA_CALL_UNAUTHORIZED'), { step: 'user', authStatus: userResponse.status });
    }
    userId = user.id;
  } catch {
    return done(fail('DSA_CALL_INTERNAL'), { step: 'user_network' });
  }

  // 2. The request.
  let sessionId: string;
  try {
    const body = (await req.json()) as { session_id?: unknown } | null;
    const raw = typeof body?.session_id === 'string' ? body.session_id.trim() : '';
    if (!UUID.test(raw)) return done(fail('DSA_CALL_BAD_REQUEST'), { step: 'session_id' });
    sessionId = raw;
  } catch {
    return done(fail('DSA_CALL_BAD_REQUEST'), { step: 'body' });
  }

  // 3. The session and its players, read with the service role. `game_secrets`
  //    is never touched: this function has no business knowing the name.
  const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  let session: SessionRow;
  let players: PlayerRow[];
  try {
    const [sessionResponse, playersResponse] = await Promise.all([
      deps.fetch(
        `${supabaseUrl}/rest/v1/game_sessions?id=eq.${sessionId}&select=id,mode,status,settings,tireur_ready_at,call_ends_at`,
        { headers: admin },
      ),
      deps.fetch(
        `${supabaseUrl}/rest/v1/game_players?game_session_id=eq.${sessionId}&select=user_id,role,is_ai`,
        { headers: admin },
      ),
    ]);
    if (!sessionResponse.ok || !playersResponse.ok) {
      return done(fail('DSA_CALL_INTERNAL'), { step: 'rest', sessionStatus: sessionResponse.status, playersStatus: playersResponse.status });
    }
    const sessions = (await sessionResponse.json()) as SessionRow[];
    players = (await playersResponse.json()) as PlayerRow[];
    if (!Array.isArray(sessions) || sessions.length === 0) return done(fail('DSA_CALL_NOT_PLAYER'), { step: 'session_missing' });
    session = sessions[0]!;
  } catch {
    return done(fail('DSA_CALL_INTERNAL'), { step: 'rest_network' });
  }

  const me = players.find((p) => p.user_id === userId && !p.is_ai);
  if (!me) return done(fail('DSA_CALL_NOT_PLAYER'), { step: 'not_player' });

  if (session.mode !== 'HUMAN_VS_HUMAN' || session.settings?.input_mode !== 'VOICE') {
    return done(fail('DSA_CALL_WRONG_MODE'), { step: 'mode' });
  }
  if (session.status !== 'PLAYING') return done(fail('DSA_CALL_OVER'), { step: 'status' });
  if (session.tireur_ready_at === null || session.call_ends_at === null) {
    return done(fail('DSA_CALL_NOT_STARTED'), { step: 'not_started' });
  }

  const endsAtMs = Date.parse(session.call_ends_at);
  if (!Number.isFinite(endsAtMs)) return done(fail('DSA_CALL_INTERNAL'), { step: 'ends_at' });
  const secondsLeft = Math.round((endsAtMs - now()) / 1000);
  if (secondsLeft <= 0) return done(fail('DSA_CALL_OVER'), { step: 'ends_at_past' });

  // 4. The token. Identity is the user id, so a phone that reconnects takes its
  //    own seat back instead of appearing as a third participant.
  const url = normalizeLiveKitUrl(env.LIVEKIT_URL);
  const room = roomNameFor(sessionId);
  let token: string;
  let roomStatus: number | null = null;
  try {
    token = await signAccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      room,
      identity: userId,
      name: callNameFor(me.role),
      ttlSeconds: secondsLeft + TOKEN_GRACE_SECONDS,
    });

    // Best effort, and only worth trying while there is time left on the call.
    const adminToken = await signAccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      room,
      identity: `dsa-server-${sessionId}`,
      ttlSeconds: 60,
      admin: true,
    });
    roomStatus = await ensureRoom(deps, httpOriginOf(url), adminToken, room);
  } catch {
    return done(fail('DSA_CALL_INTERNAL'), { step: 'sign' });
  }

  const result: TokenResult = { url, token, ends_at: session.call_ends_at };
  return done(json(200, result), { role: me.role, secondsLeft, roomStatus });
}
