// One-off check that GROQ_API_KEY and the request format work, without deploying anything.
// Reads supabase/functions/.env.local (gitignored). Sends a generated 1-second WAV of
// silence, then a 1-second 440 Hz tone, to Groq — the same fields as core.ts.
// Never prints the key. Run: npm run smoke:groq --workspace packages/voice
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'functions', '.env.local');

function readEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function wav(seconds, toneHz) {
  const rate = 16000;
  const n = rate * seconds;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, toneHz ? Math.round(Math.sin((2 * Math.PI * toneHz * i) / rate) * 8000) : 0, true);
  return bytes;
}

async function call(key, label, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'fr');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('temperature', '0');
  form.append('prompt', 'Ancien ? Oui, non, je ne sais pas, question.');
  const started = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => null);
  const ms = Date.now() - started;
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status} in ${ms} ms — ${body?.error?.message ?? 'no JSON body'}`);
    return false;
  }
  console.log(`${label}: HTTP 200 in ${ms} ms — keys ${Object.keys(body).sort().join(',')}; duration ${body.duration}; text ${JSON.stringify(body.text)}; words ${Array.isArray(body.words) ? body.words.length : 'absent'}`);
  return true;
}

if (!existsSync(ENV_FILE)) {
  console.log('skipped: no supabase/functions/.env.local');
  process.exit(0);
}
const env = readEnv(ENV_FILE);
if (!env.GROQ_API_KEY) {
  console.log('skipped: GROQ_API_KEY is not set in supabase/functions/.env.local');
  process.exit(0);
}
const ok = (await call(env.GROQ_API_KEY, 'silence 1 s', wav(1, 0))) & (await call(env.GROQ_API_KEY, 'tone 440 Hz 1 s', wav(1, 440)));
process.exit(ok ? 0 : 1);
