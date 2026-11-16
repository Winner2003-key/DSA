#!/usr/bin/env tsx
// npm run voice:probe — does a recording actually reach Groq, and what would the
// game do with what comes back?
//
//   npm run voice:probe                        # a synthetic buzz: tests the plumbing only
//   npm run voice:probe -- --file oui.m4a      # a real recording of you saying "oui"
//   npm run voice:probe -- --file oui.m4a --classes OUI,NON,OUI_REPETE
//   npm run voice:probe -- --refusals          # also check the 401 answer
//   npm run voice:probe -- --text "Hui"        # no network: what would the game do with that transcript?
//
// Why it exists: when voice "does not work", the app says « Je n'ai pas bien
// compris » for a dozen unrelated reasons — a refused microphone, a 250 ms hold,
// a missing secret, a Groq 429, a transcript the matcher does not know. This
// command splits the chain in two: everything up to and including Groq is
// printed as it happened, and then the same `@dsa/voice` code the app runs is
// applied to the transcript. Whichever half is at fault, you see it here.
//
// Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY from the
// environment, or from apps/mobile/.env. It never prints a key, and it signs in
// anonymously exactly as the app does (VOICE.md §5).

import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { AnswerClass } from '@dsa/core';
import { decideAnswer, isLikelyHallucination, readTranscript, type CanonicalLabel } from '@dsa/voice';

const out = (s = '') => process.stdout.write(`${s}\n`);
const pad = (label: string) => label.padEnd(16);

/**
 * npm runs this from `scripts/`, but anyone typing a path means it from the repo
 * root — or from wherever they are. Try both, nearest first.
 */
function locate(path: string, what = 'Le fichier'): string {
  const candidates = [resolve(process.cwd(), path), resolve(process.cwd(), '..', path)];
  const found = candidates.find(existsSync);
  if (found === undefined) {
    throw new Error(`${what} « ${path} » est introuvable. Cherché ici :\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

/** `EXPO_PUBLIC_…` from the environment, else from apps/mobile/.env. */
function config(): { url: string; anonKey: string } {
  const fromEnv = {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
  if (fromEnv.url !== '' && fromEnv.anonKey !== '') return fromEnv;

  let text: string;
  try {
    text = readFileSync(locate('apps/mobile/.env'), 'utf8');
  } catch {
    throw new Error(
      'Il manque EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY (dans l’environnement ou dans apps/mobile/.env).',
    );
  }
  const read = (key: string): string => {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const at = trimmed.indexOf('=');
      if (trimmed.slice(0, at).trim() === key) return trimmed.slice(at + 1).trim();
    }
    return '';
  };
  const url = read('EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = read('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (url === '' || anonKey === '') throw new Error(`apps/mobile/.env ne contient pas les deux clés publiques.`);
  return { url: url.replace(/\/+$/, ''), anonKey };
}

/** A mono 16 kHz WAV, so the function can read its real length from the header. */
function wav(seconds: number, sample: (t: number) => number): Buffer {
  const rate = 16_000;
  const count = Math.round(rate * seconds);
  const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const value = Math.round(Math.max(-1, Math.min(1, sample(i / rate))) * 12_000);
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Not speech — a voiced buzz. Groq answers it with subtitle credits, which is
 * itself the proof that the audio arrived and was decoded.
 */
function buzz(): { bytes: Buffer; name: string; type: string; ms: number } {
  const ms = 1_100;
  const bytes = wav(ms / 1000, (t) => {
    const fade = Math.min(1, t * 10) * Math.min(1, (ms / 1000 - t) * 10);
    let value = 0;
    for (const [harmonic, gain] of [[1, 1], [2, 0.5], [3, 0.3], [8, 0.25], [18, 0.15]] as [number, number][]) {
      value += gain * Math.sin(2 * Math.PI * 120 * harmonic * t);
    }
    return (value / 2.2) * fade;
  });
  return { bytes, name: 'bourdon.wav', type: 'audio/wav', ms };
}

const TYPES: Readonly<Record<string, string>> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};

function readAudio(path: string): { bytes: Buffer; name: string; type: string; ms: number | null } {
  const bytes = readFileSync(path);
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  const type = TYPES[ext];
  if (!type) {
    throw new Error(`Format inconnu « .${ext} ». Formats acceptés : ${Object.keys(TYPES).join(', ')}.`);
  }
  return { bytes, name: basename(path), type, ms: null };
}

async function signIn(url: string, anonKey: string): Promise<string> {
  const response = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; msg?: unknown } | null;
  out(`${pad('1. connexion')} ${response.status}   ${typeof body?.access_token === 'string' ? 'jeton utilisateur obtenu' : 'pas de jeton'}`);
  if (typeof body?.access_token !== 'string') {
    const detail = typeof body?.msg === 'string' ? body.msg : JSON.stringify(body).slice(0, 200);
    throw new Error(
      `La connexion anonyme a échoué : ${detail}\n` +
        'Active « Allow anonymous sign-ins » dans Authentication → Sign In / Providers (DATABASE_SCHEMA.md, étape 3).',
    );
  }
  return body.access_token;
}

interface Sent {
  status: number;
  ms: number;
  body: unknown;
  retryAfter: string | null;
}

async function send(url: string, anonKey: string, token: string, audio: { bytes: Buffer; name: string; type: string }, hint: string, durationMs: number | null): Promise<Sent> {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio.bytes)], { type: audio.type }), audio.name);
  if (hint !== '') form.append('hint', hint);
  if (durationMs !== null) form.append('duration_ms', String(durationMs));
  const started = Date.now();
  const response = await fetch(`${url}/functions/v1/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    body: form,
  });
  return {
    status: response.status,
    ms: Date.now() - started,
    body: await response.json().catch(() => null),
    retryAfter: response.headers.get('Retry-After'),
  };
}

/** The 401 and 415 answers, which tell apart "the gateway refused" from "the function refused". */
async function refusals(url: string, anonKey: string, audio: { bytes: Buffer; name: string; type: string }): Promise<void> {
  out();
  out('refus attendus');
  const anonAsUser = await fetch(`${url}/functions/v1/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    body: (() => {
      const form = new FormData();
      form.append('audio', new Blob([new Uint8Array(audio.bytes)], { type: audio.type }), audio.name);
      return form;
    })(),
  });
  const anonBody = (await anonAsUser.json().catch(() => null)) as { error?: unknown } | null;
  out(`${pad('  sans joueur')} ${anonAsUser.status}   ${String(anonBody?.error ?? JSON.stringify(anonBody)).slice(0, 60)}   (attendu 401 DSA_VOICE_UNAUTHORIZED)`);
}

function describeDecision(transcript: string, classes: readonly AnswerClass[]): void {
  out();
  out('4. ce que le jeu en fait');
  const hallucination = isLikelyHallucination(transcript);
  out(`${pad('  bavardage')} ${hallucination ? 'OUI — ignoré, le joueur voit « Je n’ai pas bien compris »' : 'non'}`);
  if (hallucination) return;

  const reading = readTranscript(transcript);
  out(`${pad('  lecture')} mot ${reading.word ?? '—'}   question ×${reading.rewind ?? 0}   via ${reading.via}   répétitions ${reading.repeats}`);

  // No envelope: the loudness is measured live on the phone and is not in the
  // file, so a prompt that allows OUI *and* OUIOUIOUI can only end in CONFIRM
  // here. That is the tool's limit, not the game's.
  const decision = decideAnswer({ allowedClasses: classes, transcript, envelope: null, role: 'TIREUR' });
  const label = (d: typeof decision): string =>
    d.kind === 'ANSWER' ? (d.label as CanonicalLabel) : d.kind === 'CONFIRM' ? d.options.join(' ou ') : d.kind === 'REWIND' ? `×${d.count}` : '';
  out(`${pad('  décision')} ${decision.kind} ${label(decision)}   (${decision.evidence.reason}, classes ${classes.join(', ')})`);
  if (decision.kind === 'CONFIRM') {
    out(`${pad('')} le son n’est pas dans le fichier : sur le téléphone, l’enveloppe tranche`);
  }
  if (decision.kind === 'UNKNOWN') {
    out(`${pad('')} ajoute cette ligne à scripts/voice-eval/answers.ts et relance npm run voice:eval -- --answers`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    out('Usage : npm run voice:probe [-- --file enregistrement.m4a] [--classes OUI,NON] [--hint "…"] [--refusals]');
    return;
  }
  const flag = (name: string): string | null => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? (argv[at + 1] ?? null) : null;
  };

  // --text skips the network: it answers "what would the game do with this
  // transcript", which is how a line gets added to the eval table without
  // spending a request.
  const text = flag('text');
  if (text !== null) {
    out(`texte            « ${text} »`);
    describeDecision(text, (flag('classes') ?? 'OUI,NON').split(',').map((c) => c.trim().toUpperCase()) as AnswerClass[]);
    return;
  }

  const { url, anonKey } = config();
  const file = flag('file');
  const audio = file === null ? buzz() : readAudio(locate(file, 'L’enregistrement'));
  const hint = flag('hint') ?? 'Homme ? Oui, non, je ne sais pas, question.';
  const classes = (flag('classes') ?? 'OUI,NON').split(',').map((c) => c.trim().toUpperCase()) as AnswerClass[];

  out('DSA — sonde du serveur vocal');
  out(`${pad('projet')} ${new URL(url).host}`);
  out(`${pad('audio')} ${audio.name}   ${(audio.bytes.byteLength / 1024).toFixed(1)} ko   ${audio.type}${file === null ? '   (bourdon de synthèse : teste la plomberie, pas la reconnaissance)' : ''}`);
  out();

  const token = await signIn(url, anonKey);
  const sent = await send(url, anonKey, token, audio, hint, audio.ms);

  const body = sent.body as { text?: unknown; provider?: unknown; durationMs?: unknown; words?: unknown; error?: unknown; message_fr?: unknown } | null;
  out(
    `${pad('2. transcribe')} ${sent.status}   en ${sent.ms} ms` +
      (typeof body?.provider === 'string' ? `   fournisseur ${body.provider}` : ''),
  );

  if (sent.status !== 200 || typeof body?.text !== 'string') {
    out(`${pad('  erreur')} ${String(body?.error ?? '—')}`);
    if (typeof body?.message_fr === 'string') out(`${pad('  message')} ${body.message_fr}`);
    if (sent.retryAfter !== null) out(`${pad('  Retry-After')} ${sent.retryAfter} s`);
    out();
    out('Le tableau de VOICE.md §7 donne la cause pour chaque code. L’onglet Logs de la');
    out('fonction ajoute le « step » exact (provider_keys, rpc_missing, groqStatus…).');
    process.exitCode = 1;
    if (argv.includes('--refusals')) await refusals(url, anonKey, audio);
    return;
  }

  out();
  out('3. ce que Groq a entendu');
  out(`${pad('  texte')} « ${body.text} »`);
  if (typeof body.durationMs === 'number') out(`${pad('  durée')} ${body.durationMs} ms`);
  if (Array.isArray(body.words) && body.words.length > 0) {
    const words = (body.words as { word: string; startMs: number; endMs: number }[])
      .map((w) => `${w.word} [${w.startMs}→${w.endMs}]`)
      .join('  ');
    out(`${pad('  mots')} ${words}`);
  }

  describeDecision(body.text, classes);
  if (argv.includes('--refusals')) await refusals(url, anonKey, audio);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
