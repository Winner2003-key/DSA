// DSA — Edge Function `transcribe`: all the logic, with fetch and env injected.
// No Deno globals here, so vitest can test it (packages/voice/test/transcribe-function.test.ts).
// index.ts is the thin Deno.serve wrapper.
//
// POST multipart/form-data
//   audio        required  ≤ 1.5 MB, ≤ 30 s, audio/m4a|mp4|aac|webm|ogg|wav|mpeg
//   hint         optional  ≤ 800 chars (longer is cut)
//   duration_ms  optional  the recording length measured by the client
// Authorization: Bearer <the signed-in user's access token>
//
// 200 { text, words?: [{word, startMs, endMs}], provider: 'groq'|'huggingface', durationMs }
// 4xx/5xx { error: 'DSA_VOICE_…', message_fr }
//
// Never log audio, hints, transcripts or keys.

export const MAX_AUDIO_BYTES = 1_500_000;
export const MAX_AUDIO_MS = 30_000;
export const MAX_HINT_CHARS = 800;
/** Room for the multipart boundaries, the hint and duration_ms on top of the audio. */
export const MULTIPART_OVERHEAD_BYTES = 16_000;
/** Used to estimate the length of a compressed recording for the rate limit (a low bitrate over-estimates). */
export const ASSUMED_BITRATE_BPS = 64_000;

export const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_MODEL = 'whisper-large-v3-turbo';
export const GROQ_TIMEOUT_MS = 8_000;
export const HF_MODEL = 'openai/whisper-large-v3';
export const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;
export const HF_TIMEOUT_MS = 20_000;

/** Base audio type → file extension sent to the provider. */
export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'mp4',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
};

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export type ErrorCode =
  | 'DSA_VOICE_BAD_REQUEST'
  | 'DSA_VOICE_UNAUTHORIZED'
  | 'DSA_VOICE_METHOD_NOT_ALLOWED'
  | 'DSA_VOICE_TOO_LARGE'
  | 'DSA_VOICE_TOO_LONG'
  | 'DSA_VOICE_UNSUPPORTED_TYPE'
  | 'DSA_VOICE_RATE_LIMIT'
  | 'DSA_VOICE_PROVIDER_FAILED'
  | 'DSA_VOICE_NOT_CONFIGURED'
  | 'DSA_VOICE_INTERNAL';

export const ERRORS: Readonly<Record<ErrorCode, { status: number; message_fr: string }>> = {
  DSA_VOICE_BAD_REQUEST: { status: 400, message_fr: 'Requête vocale invalide : aucun enregistrement reçu.' },
  DSA_VOICE_UNAUTHORIZED: { status: 401, message_fr: 'Connecte-toi pour utiliser la voix.' },
  DSA_VOICE_METHOD_NOT_ALLOWED: { status: 405, message_fr: 'Méthode non autorisée.' },
  DSA_VOICE_TOO_LARGE: { status: 413, message_fr: 'L’enregistrement est trop lourd (1,5 Mo au maximum).' },
  DSA_VOICE_TOO_LONG: { status: 413, message_fr: 'L’enregistrement est trop long (30 secondes au maximum).' },
  DSA_VOICE_UNSUPPORTED_TYPE: { status: 415, message_fr: 'Ce format audio n’est pas pris en charge.' },
  DSA_VOICE_RATE_LIMIT: { status: 429, message_fr: 'Trop de demandes vocales. Réessaie dans quelques minutes, ou utilise les boutons.' },
  DSA_VOICE_PROVIDER_FAILED: { status: 502, message_fr: 'La reconnaissance vocale ne répond pas. Réessaie, ou utilise les boutons.' },
  DSA_VOICE_NOT_CONFIGURED: { status: 503, message_fr: 'La reconnaissance vocale n’est pas encore configurée.' },
  DSA_VOICE_INTERNAL: { status: 500, message_fr: 'Erreur inattendue du serveur vocal.' },
};

export interface TranscribeEnv {
  GROQ_API_KEY?: string;
  HF_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** New-style keys, a JSON dictionary ({"default": "sb_publishable_…"}); used when SUPABASE_ANON_KEY is absent. */
  SUPABASE_PUBLISHABLE_KEYS?: string;
}

export type LogFields = Record<string, string | number | boolean | null>;

export interface TranscribeDeps {
  env: TranscribeEnv;
  fetch: typeof fetch;
  now?: () => number;
  /** Metadata only (status, provider, sizes, timings). Never content. */
  log?: (event: string, fields: LogFields) => void;
  groqTimeoutMs?: number;
  hfTimeoutMs?: number;
}

export interface TranscribeWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TranscribeResult {
  text: string;
  words?: TranscribeWord[];
  provider: 'groq' | 'huggingface';
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Responses

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function fail(code: ErrorCode, extra: Record<string, string> = {}): Response {
  const { status, message_fr } = ERRORS[code];
  return json(status, { error: code, message_fr }, extra);
}

// ---------------------------------------------------------------------------
// Helpers

export function baseAudioType(type: string): string {
  return type.split(';')[0]!.trim().toLowerCase();
}

function anonKeyOf(env: TranscribeEnv): string | null {
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

/** Length of a PCM WAV file from its header, or null when it can't be read. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 16 <= bytes.byteLength) byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      if (byteRate <= 0) return null;
      const available = bytes.byteLength - (offset + 8);
      return Math.round((Math.min(size, available) / byteRate) * 1000);
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function withTimeout(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Attempt =
  | { ok: true; result: TranscribeResult; providerStatus: number }
  | { ok: false; fallback: boolean; providerStatus: number | null; failure: string };

function failed(status: number | null, failure: string): Attempt {
  // Timeout / network error, 429 and 5xx go to the fallback, and so does a
  // rejected key (401/403) so one bad secret doesn't take voice down.
  const fallback = status === null || status === 429 || status >= 500 || status === 401 || status === 403;
  return { ok: false, fallback, providerStatus: status, failure };
}

interface AudioInput {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
  ext: string;
  hint: string;
  durationMs: number;
}

async function callGroq(deps: TranscribeDeps, key: string, audio: AudioInput): Promise<Attempt> {
  const form = new FormData();
  form.append('file', new Blob([audio.bytes], { type: audio.type }), `audio.${audio.ext}`);
  form.append('model', GROQ_MODEL);
  form.append('language', 'fr');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('temperature', '0');
  if (audio.hint !== '') form.append('prompt', audio.hint);

  let response: Response;
  try {
    response = await withTimeout(deps.fetch, GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, deps.groqTimeoutMs ?? GROQ_TIMEOUT_MS);
  } catch (e) {
    return failed(null, e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failed(response.status, 'status');
  }
  const body = (await response.json().catch(() => null)) as { text?: unknown; duration?: unknown; words?: unknown } | null;
  if (!body || typeof body.text !== 'string') return failed(502, 'malformed');
  const result: TranscribeResult = {
    text: body.text.trim(),
    provider: 'groq',
    durationMs: typeof body.duration === 'number' ? Math.round(body.duration * 1000) : audio.durationMs,
  };
  if (Array.isArray(body.words)) {
    result.words = (body.words as { word?: unknown; start?: unknown; end?: unknown }[])
      .filter((w) => typeof w?.word === 'string' && typeof w.start === 'number' && typeof w.end === 'number')
      .map((w) => ({ word: (w.word as string).trim(), startMs: Math.round((w.start as number) * 1000), endMs: Math.round((w.end as number) * 1000) }));
  }
  return { ok: true, result, providerStatus: response.status };
}

async function callHuggingFace(deps: TranscribeDeps, token: string, audio: AudioInput): Promise<Attempt> {
  // Raw audio bytes (no parameters), as documented for automatic-speech-recognition.
  let response: Response;
  try {
    response = await withTimeout(
      deps.fetch,
      HF_URL,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': audio.type }, body: audio.bytes },
      deps.hfTimeoutMs ?? HF_TIMEOUT_MS,
    );
  } catch (e) {
    return failed(null, e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failed(response.status, 'status');
  }
  const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
  if (!body || typeof body.text !== 'string') return failed(502, 'malformed');
  return { ok: true, result: { text: body.text.trim(), provider: 'huggingface', durationMs: audio.durationMs }, providerStatus: response.status };
}

// ---------------------------------------------------------------------------
// Handler

export async function handleTranscribe(req: Request, deps: TranscribeDeps): Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => undefined);
  const started = now();
  const done = (response: Response, fields: LogFields = {}) => {
    log('transcribe', { status: response.status, ms: now() - started, ...fields });
    return response;
  };

  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'POST') return done(fail('DSA_VOICE_METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' }));

  // 1. Signed-in user (verify_jwt already checked the signature; the anon key is a JWT too, so resolve the user).
  const authorization = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return done(fail('DSA_VOICE_UNAUTHORIZED'), { step: 'header' });

  const env = deps.env;
  const anonKey = anonKeyOf(env);
  if (!env.SUPABASE_URL || !anonKey) return done(fail('DSA_VOICE_NOT_CONFIGURED'), { step: 'supabase_env' });
  if (!env.GROQ_API_KEY && !env.HF_TOKEN) return done(fail('DSA_VOICE_NOT_CONFIGURED'), { step: 'provider_keys' });
  const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, '');

  try {
    const userResponse = await deps.fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
    const user = (await userResponse.json().catch(() => null)) as { id?: unknown } | null;
    if (!userResponse.ok || typeof user?.id !== 'string') return done(fail('DSA_VOICE_UNAUTHORIZED'), { step: 'user', authStatus: userResponse.status });
  } catch {
    return done(fail('DSA_VOICE_INTERNAL'), { step: 'user_network' });
  }

  // 2. The upload.
  const declaredLength = Number(req.headers.get('Content-Length') ?? '0');
  if (declaredLength > MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES) return done(fail('DSA_VOICE_TOO_LARGE'), { step: 'content_length', bytes: declaredLength });
  const contentType = req.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) return done(fail('DSA_VOICE_UNSUPPORTED_TYPE'), { step: 'content_type' });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return done(fail('DSA_VOICE_BAD_REQUEST'), { step: 'form' });
  }
  const file = form.get('audio');
  if (file === null || typeof file === 'string' || file.size === 0) return done(fail('DSA_VOICE_BAD_REQUEST'), { step: 'audio_missing' });
  if (file.size > MAX_AUDIO_BYTES) return done(fail('DSA_VOICE_TOO_LARGE'), { step: 'audio_size', bytes: file.size });

  let type = baseAudioType(file.type ?? '');
  if (type === '' || type === 'application/octet-stream') {
    const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
    type = Object.keys(AUDIO_TYPES).find((t) => AUDIO_TYPES[t] === ext || (ext === 'mp3' && t === 'audio/mpeg')) ?? type;
  }
  const ext = AUDIO_TYPES[type];
  if (!ext) return done(fail('DSA_VOICE_UNSUPPORTED_TYPE'), { step: 'audio_type', type: type.slice(0, 40) });

  const rawHint = form.get('hint');
  const hint = typeof rawHint === 'string' ? rawHint.trim().slice(0, MAX_HINT_CHARS) : '';

  const rawDuration = form.get('duration_ms');
  const declaredMs = typeof rawDuration === 'string' && /^\d{1,9}$/.test(rawDuration.trim()) ? Number(rawDuration) : null;
  if (declaredMs !== null && declaredMs > MAX_AUDIO_MS) return done(fail('DSA_VOICE_TOO_LONG'), { step: 'declared_duration' });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const wavMs = ext === 'wav' ? wavDurationMs(bytes) : null;
  if (wavMs !== null && wavMs > MAX_AUDIO_MS + 500) return done(fail('DSA_VOICE_TOO_LONG'), { step: 'wav_duration' });
  const estimateMs = wavMs ?? Math.ceil(((bytes.byteLength * 8) / ASSUMED_BITRATE_BPS) * 1000);
  const chargedMs = Math.min(MAX_AUDIO_MS, Math.max(1, declaredMs ?? 0, estimateMs));

  // 3. Rate limit (per user, in the database).
  try {
    const rpc = await deps.fetch(`${supabaseUrl}/rest/v1/rpc/dsa_voice_consume`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_audio_ms: chargedMs }),
    });
    if (!rpc.ok) {
      const error = (await rpc.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
      const message = typeof error?.message === 'string' ? error.message : '';
      if (message.startsWith('DSA_VOICE_RATE_LIMIT')) {
        const retry = /retry in (\d+) s/.exec(message)?.[1];
        return done(fail('DSA_VOICE_RATE_LIMIT', retry ? { 'Retry-After': retry } : {}), { step: 'rate_limit' });
      }
      if (message.startsWith('DSA_NOT_AUTHENTICATED') || rpc.status === 401 || rpc.status === 403) {
        return done(fail('DSA_VOICE_UNAUTHORIZED'), { step: 'rpc_auth', rpcStatus: rpc.status });
      }
      if (rpc.status === 404 || error?.code === 'PGRST202') return done(fail('DSA_VOICE_NOT_CONFIGURED'), { step: 'rpc_missing' });
      return done(fail('DSA_VOICE_INTERNAL'), { step: 'rpc', rpcStatus: rpc.status });
    }
    await rpc.body?.cancel().catch(() => undefined);
  } catch {
    return done(fail('DSA_VOICE_INTERNAL'), { step: 'rpc_network' });
  }

  // 4. Providers: Groq, then Hugging Face.
  const audio: AudioInput = { bytes, type, ext, hint, durationMs: wavMs ?? declaredMs ?? estimateMs };
  const meta: LogFields = { bytes: bytes.byteLength, type, hint: hint.length > 0, chargedMs };

  let groq: Attempt | null = null;
  if (env.GROQ_API_KEY) {
    groq = await callGroq(deps, env.GROQ_API_KEY, audio);
    if (groq.ok) return done(json(200, groq.result), { ...meta, provider: 'groq', providerStatus: groq.providerStatus });
  }
  const groqFields: LogFields = groq && !groq.ok ? { groqStatus: groq.providerStatus, groqFailure: groq.failure } : { groqStatus: null };
  if (env.HF_TOKEN && (groq === null || (!groq.ok && groq.fallback))) {
    const hf = await callHuggingFace(deps, env.HF_TOKEN, audio);
    if (hf.ok) return done(json(200, hf.result), { ...meta, ...groqFields, provider: 'huggingface', providerStatus: hf.providerStatus });
    return done(fail('DSA_VOICE_PROVIDER_FAILED'), { ...meta, ...groqFields, hfStatus: hf.providerStatus, hfFailure: hf.failure });
  }
  return done(fail('DSA_VOICE_PROVIDER_FAILED'), { ...meta, ...groqFields });
}
