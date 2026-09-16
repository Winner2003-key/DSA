// Client side of the `transcribe` Edge Function (GRAPH_SPECIFICATION §1).
// No DOM or React Native types: the app injects fetch and its FormData.
//
// The limits below are duplicated in supabase/functions/transcribe/core.ts
// (it is deployed on its own); test/transcribe-function.test.ts keeps both equal.

import { normalizeName } from '@dsa/core';
import { speakableName, speakablePrompt } from './speakable';

export const TRANSCRIBE_FUNCTION_NAME = 'transcribe';
export const TRANSCRIBE_MAX_AUDIO_BYTES = 1_500_000;
export const TRANSCRIBE_MAX_AUDIO_MS = 30_000;
/** The function cuts a longer hint. */
export const TRANSCRIBE_MAX_HINT_CHARS = 800;
/** What buildTranscribeHint aims for: Whisper's prompt is limited to 224 tokens. */
export const TRANSCRIBE_HINT_TARGET_CHARS = 400;
export const TRANSCRIBE_HINT_MAX_NAMES = 40;
/** Accepted `type` of the audio part (parameters such as ";codecs=opus" are ignored). */
export const TRANSCRIBE_AUDIO_TYPES = [
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
] as const;

/** Multipart field names. */
export const TRANSCRIBE_FIELDS = { audio: 'audio', hint: 'hint', durationMs: 'duration_ms' } as const;

export type TranscribeProvider = 'groq' | 'huggingface';

export interface TranscribeWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TranscribeResult {
  text: string;
  /** Per-word timings, when the provider gives them (Groq does). */
  words?: TranscribeWord[];
  provider: TranscribeProvider;
  /** Length of the audio in ms (the provider's value, or the function's estimate). */
  durationMs: number;
}

export type TranscribeErrorCode =
  | 'DSA_VOICE_BAD_REQUEST'
  | 'DSA_VOICE_UNAUTHORIZED'
  | 'DSA_VOICE_METHOD_NOT_ALLOWED'
  | 'DSA_VOICE_TOO_LARGE'
  | 'DSA_VOICE_TOO_LONG'
  | 'DSA_VOICE_UNSUPPORTED_TYPE'
  | 'DSA_VOICE_RATE_LIMIT'
  | 'DSA_VOICE_PROVIDER_FAILED'
  | 'DSA_VOICE_NOT_CONFIGURED'
  | 'DSA_VOICE_INTERNAL'
  /** Client-side only: the network call itself failed. */
  | 'DSA_VOICE_NETWORK';

export interface TranscribeErrorBody {
  error: TranscribeErrorCode;
  message_fr: string;
}

export const TRANSCRIBE_NETWORK_MESSAGE_FR = 'Pas de connexion au serveur vocal. Vérifie ta connexion, ou utilise les boutons.';

export class TranscribeError extends Error {
  readonly code: TranscribeErrorCode;
  readonly status: number;
  readonly messageFr: string;
  /** Seconds to wait, from Retry-After (rate limit only). */
  readonly retryAfterS: number | null;

  constructor(code: TranscribeErrorCode, status: number, messageFr: string, retryAfterS: number | null = null) {
    super(`${code} (${status})`);
    this.name = 'TranscribeError';
    this.code = code;
    this.status = status;
    this.messageFr = messageFr;
    this.retryAfterS = retryAfterS;
  }
}

export interface TranscribeOptions {
  hint?: string;
  /** Recording length measured by the client; used for the rate limit. */
  durationMs?: number;
}

/** What the app implements (recording → text). The audio type is the platform's own. */
export interface SpeechToText<Audio = unknown> {
  readonly available: boolean;
  transcribe(audio: Audio, opts?: TranscribeOptions): Promise<TranscribeResult>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates a 200 response body. Throws TranscribeError('DSA_VOICE_INTERNAL') when it's malformed. */
export function parseTranscribeResult(json: unknown): TranscribeResult {
  const bad = () => new TranscribeError('DSA_VOICE_INTERNAL', 200, 'Réponse inattendue du serveur vocal.');
  if (!isObject(json) || typeof json.text !== 'string') throw bad();
  if (json.provider !== 'groq' && json.provider !== 'huggingface') throw bad();
  const durationMs = typeof json.durationMs === 'number' && Number.isFinite(json.durationMs) ? json.durationMs : 0;
  const result: TranscribeResult = { text: json.text, provider: json.provider, durationMs };
  if (Array.isArray(json.words)) {
    result.words = json.words
      .filter(isObject)
      .filter((w) => typeof w.word === 'string' && typeof w.startMs === 'number' && typeof w.endMs === 'number')
      .map((w) => ({ word: w.word as string, startMs: w.startMs as number, endMs: w.endMs as number }));
  }
  return result;
}

/** Builds the error for a non-200 response. */
export function parseTranscribeError(status: number, json: unknown, retryAfter: string | null = null): TranscribeError {
  const retry = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
  if (isObject(json) && typeof json.error === 'string' && json.error.startsWith('DSA_VOICE_') && typeof json.message_fr === 'string') {
    return new TranscribeError(json.error as TranscribeErrorCode, status, json.message_fr, retry);
  }
  if (status === 401) return new TranscribeError('DSA_VOICE_UNAUTHORIZED', status, 'Connecte-toi pour utiliser la voix.');
  return new TranscribeError('DSA_VOICE_INTERNAL', status, 'Erreur inattendue du serveur vocal.', retry);
}

// ---------------------------------------------------------------------------
// Hint

export interface TranscribeHintOptions {
  /** Other texts on screen (path, clues) whose names should come first. */
  context?: readonly string[];
  maxNames?: number;
  maxChars?: number;
}

const ANSWER_WORDS = 'Oui, non, je ne sais pas, question.';

/**
 * The Whisper prompt: the question being asked (speakable form), the answer
 * words, then up to 40 names. Names mentioned in the prompt or the context
 * come first, then `knownNames` in the caller's order (pass the most likely
 * ones first). Stays under TRANSCRIBE_HINT_TARGET_CHARS without cutting a name.
 */
export function buildTranscribeHint(prompt: string | null, knownNames: readonly string[], opts: TranscribeHintOptions = {}): string {
  const maxNames = opts.maxNames ?? TRANSCRIBE_HINT_MAX_NAMES;
  const maxChars = Math.min(opts.maxChars ?? TRANSCRIBE_HINT_TARGET_CHARS, TRANSCRIBE_MAX_HINT_CHARS);

  const head = [prompt ? speakablePrompt(prompt) : '', ANSWER_WORDS].filter((s) => s !== '').join(' ');
  let hint = head.length <= maxChars ? head : head.slice(0, maxChars).replace(/\s+\S*$/, '');

  const onScreen = [prompt ?? '', ...(opts.context ?? [])].map(normalizeName).join(' ');
  const seen = new Set<string>();
  const unique = knownNames.filter((name) => {
    const key = normalizeName(name);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const mentioned = (name: string) => normalizeName(name).length >= 3 && onScreen.includes(normalizeName(name));
  const ranked = [...unique.filter(mentioned), ...unique.filter((n) => !mentioned(n))];

  const names: string[] = [];
  for (const name of ranked) {
    if (names.length >= maxNames) break;
    const spoken = speakableName(name);
    const candidate = `${hint} ${[...names, spoken].join(', ')}.`;
    if (candidate.length > maxChars) break;
    names.push(spoken);
  }
  if (names.length > 0) hint = `${hint} ${names.join(', ')}.`;
  return hint;
}

// ---------------------------------------------------------------------------
// Client

/** The subset of FormData the client needs (web FormData and React Native's both fit). */
export interface FormDataLike {
  append(name: string, value: unknown, fileName?: string): void;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface TranscribeClientConfig<Audio> {
  /** `https://<ref>.supabase.co` (EXPO_PUBLIC_SUPABASE_URL). */
  supabaseUrl: string;
  /** The anon / publishable key (EXPO_PUBLIC_SUPABASE_ANON_KEY). */
  anonKey: string;
  /** The signed-in user's access token (`(await supabase.auth.getSession()).data.session?.access_token`). */
  getAccessToken: () => Promise<string | null>;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: unknown }) => Promise<ResponseLike>;
  createFormData: () => FormDataLike;
  /** Appends the audio part: web `form.append('audio', blob, 'answer.webm')`, native `form.append('audio', {uri, name, type})`. */
  appendAudio: (form: FormDataLike, field: string, audio: Audio) => void;
}

export function transcribeUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${TRANSCRIBE_FUNCTION_NAME}`;
}

/** A SpeechToText that calls the Edge Function. */
export function createTranscribeClient<Audio>(config: TranscribeClientConfig<Audio>): SpeechToText<Audio> {
  return {
    available: true,
    async transcribe(audio, opts = {}) {
      const token = await config.getAccessToken();
      if (!token) throw new TranscribeError('DSA_VOICE_UNAUTHORIZED', 401, 'Connecte-toi pour utiliser la voix.');
      const form = config.createFormData();
      config.appendAudio(form, TRANSCRIBE_FIELDS.audio, audio);
      if (opts.hint) form.append(TRANSCRIBE_FIELDS.hint, opts.hint.slice(0, TRANSCRIBE_MAX_HINT_CHARS));
      if (opts.durationMs !== undefined && Number.isFinite(opts.durationMs)) {
        form.append(TRANSCRIBE_FIELDS.durationMs, String(Math.max(0, Math.round(opts.durationMs))));
      }
      let response: ResponseLike;
      try {
        // No Content-Type header: the platform sets the multipart boundary.
        response = await config.fetch(transcribeUrl(config.supabaseUrl), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: config.anonKey },
          body: form,
        });
      } catch {
        throw new TranscribeError('DSA_VOICE_NETWORK', 0, TRANSCRIBE_NETWORK_MESSAGE_FR);
      }
      const json = await response.json().catch(() => null);
      if (!response.ok) throw parseTranscribeError(response.status, json, response.headers.get('Retry-After'));
      return parseTranscribeResult(json);
    },
  };
}
