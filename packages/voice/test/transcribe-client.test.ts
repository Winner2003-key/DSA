import { describe, expect, it } from 'vitest';
import {
  TRANSCRIBE_HINT_MAX_NAMES,
  TRANSCRIBE_HINT_TARGET_CHARS,
  TranscribeError,
  buildTranscribeHint,
  createTranscribeClient,
  parseTranscribeError,
  parseTranscribeResult,
  transcribeUrl,
} from '../src';
import type { FormDataLike } from '../src';

describe('buildTranscribeHint', () => {
  const names = Array.from({ length: 300 }, (_, i) => `NOM${String.fromCharCode(65 + (i % 26))}${i}`);

  it('starts with the speakable prompt and the answer words', () => {
    expect(buildTranscribeHint('LIE A DAVID', [])).toBe('Lié à David ? Oui, non, je ne sais pas, question.');
    expect(buildTranscribeHint(null, [])).toBe('Oui, non, je ne sais pas, question.');
  });

  it('keeps at most 40 names and stays under the target length', () => {
    const hint = buildTranscribeHint('ANCIEN', names, { maxChars: 2000 });
    expect(hint.split(', ').length).toBeLessThanOrEqual(TRANSCRIBE_HINT_MAX_NAMES + 4);
    expect(hint.match(/Nom[a-z]\d+/g)?.length).toBe(TRANSCRIBE_HINT_MAX_NAMES);
    const short = buildTranscribeHint('ANCIEN', names);
    expect(short.length).toBeLessThanOrEqual(TRANSCRIBE_HINT_TARGET_CHARS);
    expect(short.endsWith('.')).toBe(true);
    expect(short).not.toMatch(/, $/);
  });

  it('puts names seen in the prompt or on screen first, deduplicated, as spoken names', () => {
    const hint = buildTranscribeHint('Serviteur de MOISE', ['ABEL', 'ABSALOM', 'MOÏSE', 'Moise', 'JOSUE'], { context: ['LIE A JOSUE'] });
    expect(hint).toBe('Serviteur de Moïse ? Oui, non, je ne sais pas, question. Moïse, Josué, Abel, Absalom.');
  });
});

describe('response parsing', () => {
  it('parses a result and drops malformed words', () => {
    expect(parseTranscribeResult({ text: 'Oui', provider: 'groq', durationMs: 900, words: [{ word: 'Oui', startMs: 0, endMs: 400 }, { word: 3 }] })).toEqual({
      text: 'Oui',
      provider: 'groq',
      durationMs: 900,
      words: [{ word: 'Oui', startMs: 0, endMs: 400 }],
    });
    expect(() => parseTranscribeResult({ text: 'Oui', provider: 'openai' })).toThrow(TranscribeError);
  });

  it('parses error bodies and Retry-After', () => {
    const e = parseTranscribeError(429, { error: 'DSA_VOICE_RATE_LIMIT', message_fr: 'Trop de demandes.' }, '42');
    expect([e.code, e.status, e.messageFr, e.retryAfterS]).toEqual(['DSA_VOICE_RATE_LIMIT', 429, 'Trop de demandes.', 42]);
    expect(parseTranscribeError(401, { message: 'Invalid JWT' }).code).toBe('DSA_VOICE_UNAUTHORIZED');
    expect(parseTranscribeError(500, null).code).toBe('DSA_VOICE_INTERNAL');
  });
});

describe('createTranscribeClient', () => {
  class Form implements FormDataLike {
    parts: [string, unknown, string | undefined][] = [];
    append(name: string, value: unknown, fileName?: string) {
      this.parts.push([name, value, fileName]);
    }
  }

  function setup(response: { status: number; body: unknown; headers?: Record<string, string> } | 'network', token: string | null = 'jwt') {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: unknown } }[] = [];
    const client = createTranscribeClient<{ uri: string }>({
      supabaseUrl: 'https://abc.supabase.co/',
      anonKey: 'anon',
      getAccessToken: async () => token,
      createFormData: () => new Form(),
      appendAudio: (form, field, audio) => form.append(field, { uri: audio.uri, name: 'answer.m4a', type: 'audio/m4a' }),
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (response === 'network') throw new Error('offline');
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          headers: { get: (name: string) => response.headers?.[name] ?? null },
          json: async () => response.body,
        };
      },
    });
    return { client, calls };
  }

  it('posts the multipart form with the user token and returns the result', async () => {
    const { client, calls } = setup({ status: 200, body: { text: 'Oui', provider: 'groq', durationMs: 800 } });
    await expect(client.transcribe({ uri: 'file:///a.m4a' }, { hint: 'Homme ?', durationMs: 812.4 })).resolves.toEqual({ text: 'Oui', provider: 'groq', durationMs: 800 });
    expect(calls[0]!.url).toBe('https://abc.supabase.co/functions/v1/transcribe');
    expect(calls[0]!.init.headers).toEqual({ Authorization: 'Bearer jwt', apikey: 'anon' });
    expect((calls[0]!.init.body as Form).parts).toEqual([
      ['audio', { uri: 'file:///a.m4a', name: 'answer.m4a', type: 'audio/m4a' }, undefined],
      ['hint', 'Homme ?', undefined],
      ['duration_ms', '812', undefined],
    ]);
    expect(transcribeUrl('https://x.supabase.co')).toBe('https://x.supabase.co/functions/v1/transcribe');
  });

  it('throws French errors: no session, server error, network', async () => {
    await expect(setup({ status: 200, body: {} }, null).client.transcribe({ uri: 'a' })).rejects.toMatchObject({ code: 'DSA_VOICE_UNAUTHORIZED' });
    await expect(setup({ status: 429, body: { error: 'DSA_VOICE_RATE_LIMIT', message_fr: 'Trop.' }, headers: { 'Retry-After': '30' } }).client.transcribe({ uri: 'a' })).rejects.toMatchObject({
      code: 'DSA_VOICE_RATE_LIMIT',
      retryAfterS: 30,
    });
    await expect(setup('network').client.transcribe({ uri: 'a' })).rejects.toMatchObject({ code: 'DSA_VOICE_NETWORK', status: 0 });
  });
});
