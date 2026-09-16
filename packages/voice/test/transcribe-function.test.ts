// Handler tests for supabase/functions/transcribe/core.ts, with a mocked fetch.
import { describe, expect, it } from 'vitest';
import {
  AUDIO_TYPES,
  ERRORS,
  GROQ_MODEL,
  GROQ_URL,
  HF_URL,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  MAX_HINT_CHARS,
  handleTranscribe,
  wavDurationMs,
} from '../../../supabase/functions/transcribe/core.ts';
import type { LogFields, TranscribeDeps } from '../../../supabase/functions/transcribe/core.ts';
import { TRANSCRIBE_AUDIO_TYPES, TRANSCRIBE_MAX_AUDIO_BYTES, TRANSCRIBE_MAX_AUDIO_MS, TRANSCRIBE_MAX_HINT_CHARS } from '../src';

const SUPABASE_URL = 'https://abc.supabase.co';
const USER_JWT = 'user.jwt.token';
const GROQ_KEY = 'gsk_test_SECRET_groq';
const HF_KEY = 'hf_test_SECRET_hf';
const SECRET_TEXT = 'Ouiiii secret transcript';

interface Call {
  url: string;
  init: RequestInit;
}

type Route = (init: RequestInit) => Promise<Response> | Response;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(routes: { user?: Route; rpc?: Route; groq?: Route; hf?: Route } = {}) {
  const calls: Call[] = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${SUPABASE_URL}/auth/v1/user`) return (routes.user ?? (() => jsonResponse(200, { id: 'user-1', role: 'authenticated' })))(init);
    if (url === `${SUPABASE_URL}/rest/v1/rpc/dsa_voice_consume`) return (routes.rpc ?? (() => jsonResponse(200, { requests_left: 39, audio_ms_left: 898000 })))(init);
    if (url === GROQ_URL) return (routes.groq ?? (() => jsonResponse(200, { text: ` ${SECRET_TEXT} `, duration: 1.24, words: [{ word: 'Ouiiii', start: 0.1, end: 0.9 }] })))(init);
    if (url === HF_URL) return (routes.hf ?? (() => jsonResponse(200, { text: SECRET_TEXT })))(init);
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetch: fetcher as typeof fetch, calls };
}

function deps(fetcher: typeof fetch, extra: Partial<TranscribeDeps> = {}) {
  const logs: { event: string; fields: LogFields }[] = [];
  const d: TranscribeDeps = {
    env: { SUPABASE_URL, SUPABASE_ANON_KEY: 'anon-key', GROQ_API_KEY: GROQ_KEY, HF_TOKEN: HF_KEY },
    fetch: fetcher,
    log: (event, fields) => logs.push({ event, fields }),
    ...extra,
  };
  return { d, logs };
}

function request(opts: { auth?: string | null; size?: number; type?: string; hint?: string; durationMs?: string; method?: string; body?: BodyInit; fileName?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.Authorization = opts.auth ?? `Bearer ${USER_JWT}`;
  if (opts.method && opts.method !== 'POST') return new Request('https://fn.local/transcribe', { method: opts.method, headers });
  let body = opts.body;
  if (body === undefined) {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(opts.size ?? 20_000)], { type: opts.type ?? 'audio/m4a' }), opts.fileName ?? 'answer.m4a');
    if (opts.hint !== undefined) form.append('hint', opts.hint);
    if (opts.durationMs !== undefined) form.append('duration_ms', opts.durationMs);
    body = form;
  }
  return new Request('https://fn.local/transcribe', { method: 'POST', headers, body });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function groqForm(calls: Call[]): FormData {
  const call = calls.find((c) => c.url === GROQ_URL);
  if (!call) throw new Error('Groq was not called');
  return call.init.body as FormData;
}

describe('transcribe function — requests that never reach a provider', () => {
  it('answers the CORS preflight', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ method: 'OPTIONS', auth: null }), deps(fetch).d);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(calls).toHaveLength(0);
  });

  it('no JWT → 401', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ auth: null }), deps(fetch).d);
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({ error: 'DSA_VOICE_UNAUTHORIZED', message_fr: ERRORS.DSA_VOICE_UNAUTHORIZED.message_fr });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(calls).toHaveLength(0);
  });

  it('a token that is not a user (e.g. the anon key) → 401', async () => {
    const { fetch, calls } = mockFetch({ user: () => jsonResponse(403, { msg: 'invalid claim: missing sub claim' }) });
    const res = await handleTranscribe(request({ auth: 'Bearer anon-key' }), deps(fetch).d);
    expect(res.status).toBe(401);
    expect(calls.map((c) => c.url)).toEqual([`${SUPABASE_URL}/auth/v1/user`]);
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('anon-key');
  });

  it('GET → 405', async () => {
    const { fetch } = mockFetch();
    expect((await handleTranscribe(request({ method: 'GET' }), deps(fetch).d)).status).toBe(405);
  });

  it('too large → 413, and no rate-limit charge', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ size: MAX_AUDIO_BYTES + 1 }), deps(fetch).d);
    expect(res.status).toBe(413);
    expect((await bodyOf(res)).error).toBe('DSA_VOICE_TOO_LARGE');
    expect(calls.some((c) => c.url.includes('rpc'))).toBe(false);
  });

  it('declared longer than 30 s → 413 DSA_VOICE_TOO_LONG', async () => {
    const { fetch } = mockFetch();
    const res = await handleTranscribe(request({ durationMs: String(MAX_AUDIO_MS + 1) }), deps(fetch).d);
    expect(res.status).toBe(413);
    expect((await bodyOf(res)).error).toBe('DSA_VOICE_TOO_LONG');
  });

  it('a WAV whose header says 31 s → 413', async () => {
    const { fetch } = mockFetch();
    const res = await handleTranscribe(request({ body: formWith(wav(31_000, 8000), 'audio/wav', 'a.wav') }), deps(fetch).d);
    expect(res.status).toBe(413);
  });

  it('wrong type → 415', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ type: 'video/quicktime', fileName: 'a.mov' }), deps(fetch).d);
    expect(res.status).toBe(415);
    expect((await bodyOf(res)).error).toBe('DSA_VOICE_UNSUPPORTED_TYPE');
    expect(calls.some((c) => c.url === GROQ_URL)).toBe(false);
  });

  it('a body that is not multipart → 415', async () => {
    const { fetch } = mockFetch();
    const res = await handleTranscribe(request({ body: JSON.stringify({ audio: 'x' }) }), deps(fetch).d);
    expect(res.status).toBe(415);
  });

  it('no audio part → 400', async () => {
    const { fetch } = mockFetch();
    const form = new FormData();
    form.append('hint', 'Ancien ?');
    const res = await handleTranscribe(request({ body: form }), deps(fetch).d);
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('DSA_VOICE_BAD_REQUEST');
  });

  it('rate limited → 429 with Retry-After, and no provider call', async () => {
    const { fetch, calls } = mockFetch({
      rpc: () => jsonResponse(400, { code: 'P0001', message: 'DSA_VOICE_RATE_LIMIT: 40 requests per 10 minutes; retry in 42 s' }),
    });
    const res = await handleTranscribe(request(), deps(fetch).d);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect((await bodyOf(res)).error).toBe('DSA_VOICE_RATE_LIMIT');
    expect(calls.some((c) => c.url === GROQ_URL || c.url === HF_URL)).toBe(false);
  });

  it('the rate-limit SQL is not installed → 503 DSA_VOICE_NOT_CONFIGURED', async () => {
    const { fetch } = mockFetch({ rpc: () => jsonResponse(404, { code: 'PGRST202', message: 'Could not find the function public.dsa_voice_consume' }) });
    const res = await handleTranscribe(request(), deps(fetch).d);
    expect(res.status).toBe(503);
  });

  it('no provider key at all → 503 before charging', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request(), deps(fetch, { env: { SUPABASE_URL, SUPABASE_ANON_KEY: 'anon-key' } }).d);
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe('transcribe function — providers', () => {
  it('Groq ok: verbose_json with word timestamps, French, the hint as prompt', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ hint: 'Homme ? Oui, non.', durationMs: '1200' }), deps(fetch).d);
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ text: SECRET_TEXT, provider: 'groq', durationMs: 1240, words: [{ word: 'Ouiiii', startMs: 100, endMs: 900 }] });
    const form = groqForm(calls);
    expect(form.get('model')).toBe(GROQ_MODEL);
    expect(form.get('language')).toBe('fr');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word']);
    expect(form.get('prompt')).toBe('Homme ? Oui, non.');
    expect((form.get('file') as File).name).toBe('audio.m4a');
    const groqCall = calls.find((c) => c.url === GROQ_URL)!;
    expect((groqCall.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GROQ_KEY}`);
    expect(calls.some((c) => c.url === HF_URL)).toBe(false);
  });

  it('charges the rate limit with the larger of the declared and estimated lengths', async () => {
    const { fetch, calls } = mockFetch();
    await handleTranscribe(request({ size: 40_000, durationMs: '1500' }), deps(fetch).d);
    const rpc = calls.find((c) => c.url.endsWith('dsa_voice_consume'))!;
    expect(JSON.parse(rpc.init.body as string)).toEqual({ p_audio_ms: 5000 }); // 40 kB at 64 kbit/s
    expect((rpc.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_JWT}`);
  });

  it('a WAV is charged its exact length', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ body: formWith(wav(1000, 16000), 'audio/wav', 'a.wav') }), deps(fetch).d);
    expect(res.status).toBe(200);
    const rpc = calls.find((c) => c.url.endsWith('dsa_voice_consume'))!;
    expect(JSON.parse(rpc.init.body as string)).toEqual({ p_audio_ms: 1000 });
  });

  it('the hint is truncated to 800 characters', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request({ hint: 'David, '.repeat(200) }), deps(fetch).d);
    expect(res.status).toBe(200);
    expect(String(groqForm(calls).get('prompt'))).toHaveLength(MAX_HINT_CHARS);
  });

  it('Groq 429 → Hugging Face (raw audio bytes, the audio content type)', async () => {
    const { fetch, calls } = mockFetch({ groq: () => jsonResponse(429, { error: { message: 'rate limit' } }) });
    const res = await handleTranscribe(request({ type: 'audio/webm;codecs=opus', fileName: 'a.webm' }), deps(fetch).d);
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({ text: SECRET_TEXT, provider: 'huggingface' });
    const hf = calls.find((c) => c.url === HF_URL)!;
    expect(hf.init.headers).toEqual({ Authorization: `Bearer ${HF_KEY}`, 'Content-Type': 'audio/webm' });
    expect(hf.init.body).toBeInstanceOf(Uint8Array);
    expect((hf.init.body as Uint8Array).byteLength).toBe(20_000);
  });

  it('Groq 503 → Hugging Face', async () => {
    const { fetch } = mockFetch({ groq: () => jsonResponse(503, {}) });
    const res = await handleTranscribe(request(), deps(fetch).d);
    expect((await bodyOf(res)).provider).toBe('huggingface');
  });

  it('Groq timeout (8 s) → Hugging Face', async () => {
    const hang: Route = (init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const { fetch } = mockFetch({ groq: hang });
    const { d, logs } = deps(fetch, { groqTimeoutMs: 20 });
    const res = await handleTranscribe(request(), d);
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).provider).toBe('huggingface');
    expect(logs.at(-1)!.fields).toMatchObject({ groqFailure: 'timeout', provider: 'huggingface' });
  });

  it('Groq 400 (bad audio) does not fall back → 502', async () => {
    const { fetch, calls } = mockFetch({ groq: () => jsonResponse(400, { error: { message: 'could not decode' } }) });
    const res = await handleTranscribe(request(), deps(fetch).d);
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.url === HF_URL)).toBe(false);
  });

  it('both fail → 502', async () => {
    const { fetch } = mockFetch({ groq: () => jsonResponse(500, {}), hf: () => jsonResponse(503, { error: 'loading' }) });
    const res = await handleTranscribe(request(), deps(fetch).d);
    expect(res.status).toBe(502);
    expect(await bodyOf(res)).toEqual({ error: 'DSA_VOICE_PROVIDER_FAILED', message_fr: ERRORS.DSA_VOICE_PROVIDER_FAILED.message_fr });
  });

  it('only HF_TOKEN set → Hugging Face directly', async () => {
    const { fetch, calls } = mockFetch();
    const res = await handleTranscribe(request(), deps(fetch, { env: { SUPABASE_URL, SUPABASE_ANON_KEY: 'anon-key', HF_TOKEN: HF_KEY } }).d);
    expect((await bodyOf(res)).provider).toBe('huggingface');
    expect(calls.some((c) => c.url === GROQ_URL)).toBe(false);
  });

  it('uses SUPABASE_PUBLISHABLE_KEYS when there is no legacy anon key', async () => {
    const { fetch, calls } = mockFetch();
    const env = { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_x"}', GROQ_API_KEY: GROQ_KEY };
    expect((await handleTranscribe(request(), deps(fetch, { env }).d)).status).toBe(200);
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('sb_publishable_x');
  });

  it('never logs audio, hints, transcripts or keys', async () => {
    const { fetch } = mockFetch({ groq: () => jsonResponse(429, {}) });
    const { d, logs } = deps(fetch);
    await handleTranscribe(request({ hint: 'Lié à David ? Absalom' }), d);
    const { fetch: fetch2 } = mockFetch();
    const second = deps(fetch2);
    await handleTranscribe(request({ hint: 'Lié à David ? Absalom' }), second.d);
    const text = JSON.stringify([...logs, ...second.logs]);
    expect(logs.length + second.logs.length).toBe(2);
    for (const secret of [SECRET_TEXT, 'Absalom', GROQ_KEY, HF_KEY, USER_JWT, 'anon-key']) expect(text).not.toContain(secret);
  });
});

describe('transcribe function — shared limits', () => {
  it('matches the client constants in @dsa/voice', () => {
    expect(MAX_AUDIO_BYTES).toBe(TRANSCRIBE_MAX_AUDIO_BYTES);
    expect(MAX_AUDIO_MS).toBe(TRANSCRIBE_MAX_AUDIO_MS);
    expect(MAX_HINT_CHARS).toBe(TRANSCRIBE_MAX_HINT_CHARS);
    expect(Object.keys(AUDIO_TYPES).sort()).toEqual([...TRANSCRIBE_AUDIO_TYPES].sort());
  });

  it('reads WAV durations', () => {
    expect(wavDurationMs(wav(1500, 16000))).toBe(1500);
    expect(wavDurationMs(new Uint8Array(100))).toBeNull();
  });
});

// A mono 16-bit PCM WAV of `ms` milliseconds of silence.
function wav(ms: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = Math.round((sampleRate * ms) / 1000) * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function formWith(bytes: Uint8Array<ArrayBuffer>, type: string, name: string): FormData {
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type }), name);
  return form;
}
