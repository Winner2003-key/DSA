// Turns a spoken Tireur answer into a canonical book label.
//
// The WORD (oui / non / je ne sais pas / question ×N) comes from the transcript.
// SIMPLE vs REPEATED (OUI vs OUIOUIOUI) comes from the SOUND, because Whisper
// writes a held "ouiiii" as "Oui" (GRAPH_SPECIFICATION §1). The transcript's
// own hints ("ouiii", "oui oui oui") are supporting evidence only: they can
// raise a doubt, never decide.

import { answerClass, matchIntent, tokenize } from '@dsa/core';
import type { AnswerClass, Role } from '@dsa/core';
import { DEFAULT_CALIBRATION, soundLengthMs } from './calibration';
import type { Calibration } from './calibration';
import type { EnvelopeAnalysis } from './envelope';

/** A sound within ±15 % of the threshold is borderline: ask with two buttons. */
export const BORDERLINE_RATIO = 0.15;

export type CanonicalLabel = 'OUI' | 'OUIOUIOUI' | 'NON' | 'NONONONON' | 'JE NE SAIS PAS';

/** The book's page-2 spelling of each answer class (GRAPH_SPECIFICATION §2, §7). */
export const CANONICAL_LABELS: Readonly<Record<Exclude<AnswerClass, 'AUTRE'>, CanonicalLabel>> = Object.freeze({
  OUI: 'OUI',
  OUI_REPETE: 'OUIOUIOUI',
  NON: 'NON',
  NON_REPETE: 'NONONONON',
  JE_NE_SAIS_PAS: 'JE NE SAIS PAS',
});

export type AnswerWord = 'OUI' | 'NON' | 'JE_NE_SAIS_PAS';

export interface TranscriptReading {
  /** The answer word, or null when the transcript holds no clear answer. */
  word: AnswerWord | null;
  /** "question" said N times (1–3), or null. */
  rewind: 1 | 2 | 3 | null;
  /** How many times the answer word was written ("oui oui oui" → 3, "ouioui" → 2). */
  repeats: number;
  /** The word was written stretched ("ouiii", "nooon", "nonnn"). */
  elongated: boolean;
  /** Other words were spoken too ("euh, oui"), which explains extra bursts. */
  extraWords: boolean;
}

const ALL_LABELS: string[] = Object.values(CANONICAL_LABELS);

interface TokenReading {
  word: 'OUI' | 'NON' | null;
  count: number;
  elongated: boolean;
}

function readToken(token: string): TokenReading {
  if (token === 'oui' || token === 'ouais' || token === 'ouai') return { word: 'OUI', count: 1, elongated: false };
  if (token === 'non' || token === 'nan') return { word: 'NON', count: 1, elongated: false };
  if (/^(oui){2,}$/.test(token)) return { word: 'OUI', count: token.length / 3, elongated: false };
  if (/^o+u+i+s?$/.test(token) || /^o+u+a+i+s?$/.test(token)) return { word: 'OUI', count: 1, elongated: true };
  if (/^n+o+n+$/.test(token) || /^n+a+n+$/.test(token)) return { word: 'NON', count: 1, elongated: true };
  const cls = answerClass(token);
  if (cls === 'OUI_REPETE') return { word: 'OUI', count: 2, elongated: false };
  if (cls === 'NON_REPETE') return { word: 'NON', count: Math.max(2, (token.match(/no(?=n)/g) ?? []).length), elongated: false };
  return { word: null, count: 0, elongated: false };
}

/** Reads the answer word and the transcript's repetition hints. */
export function readTranscript(transcript: string): TranscriptReading {
  const none: TranscriptReading = { word: null, rewind: null, repeats: 0, elongated: false, extraWords: false };
  const tokens = tokenize(transcript);
  if (tokens.length === 0) return none;

  const readings = tokens.map(readToken);
  const answerWords = new Set(readings.map((r) => r.word).filter((w) => w !== null));
  const extraWords = readings.some((r) => r.word === null);
  const repeats = readings.reduce((sum, r) => sum + r.count, 0);
  const elongated = readings.some((r) => r.elongated);

  // Stretched spellings become the plain word so the core matcher recognises them.
  const plain = readings.map((r, i) => (r.word === null ? tokens[i] : r.word.toLowerCase())).join(' ');
  const intent = matchIntent(plain, { role: 'TIREUR', prompt: null, answerLabels: ALL_LABELS, knownNames: [], path: [] });

  if (intent.type === 'REWIND') return { ...none, rewind: intent.count };
  if (intent.type === 'ANSWER') {
    const cls = answerClass(intent.label);
    if (cls === 'JE_NE_SAIS_PAS') return { ...none, word: 'JE_NE_SAIS_PAS', repeats: 1, extraWords: false };
    const word: AnswerWord = cls === 'NON' || cls === 'NON_REPETE' ? 'NON' : 'OUI';
    return { word, rewind: null, repeats: Math.max(1, repeats), elongated, extraWords };
  }
  // Lenient pass: one answer word among a few other words ("oui oui c'est ça", "je crois que oui").
  if (answerWords.size === 1 && tokens.length - readings.filter((r) => r.word !== null).length <= 3) {
    const word = [...answerWords][0] as 'OUI' | 'NON';
    return { word, rewind: null, repeats, elongated, extraWords };
  }
  return none;
}

export type SoundVerdict = 'SIMPLE' | 'REPEATED' | 'BORDERLINE' | 'NO_SOUND';

export type DecisionReason =
  | 'NOT_TIREUR'
  | 'NO_ANSWER_WORD'
  | 'REWIND'
  | 'NOT_ALLOWED'
  | 'NO_REPEATED_FORM'
  | 'ONLY_SIMPLE_ALLOWED'
  | 'ONLY_REPEATED_ALLOWED'
  | 'LONG_SOUND'
  | 'REPEATED_BURSTS'
  | 'BURSTS_UNCONFIRMED'
  | 'NEAR_THRESHOLD'
  | 'TRANSCRIPT_DISAGREES'
  | 'SHORT_SOUND'
  | 'NO_SOUND';

export interface DecisionEvidence {
  reason: DecisionReason;
  word: AnswerWord | null;
  verdict: SoundVerdict | null;
  soundMs: number;
  voicedMs: number;
  bursts: number;
  thresholdMs: number;
  transcriptRepeats: number;
  transcriptElongated: boolean;
}

export type AnswerDecision =
  | { kind: 'ANSWER'; label: CanonicalLabel; evidence: DecisionEvidence }
  | { kind: 'CONFIRM'; options: [CanonicalLabel, CanonicalLabel]; evidence: DecisionEvidence }
  | { kind: 'REWIND'; count: 1 | 2 | 3; evidence: DecisionEvidence }
  | { kind: 'UNKNOWN'; evidence: DecisionEvidence };

export interface DecideAnswerInput {
  /** The prompt's answer classes (`prompt.answer_classes`). */
  allowedClasses: readonly AnswerClass[];
  transcript: string;
  /** The analysed metering envelope of the same recording, or null when there was none. */
  envelope: EnvelopeAnalysis | null;
  calibration?: Calibration;
  role: Role;
  borderlineRatio?: number;
}

/** Classifies the sound as a plain or a repeated answer, using the transcript only to raise doubts. */
export function classifySound(
  envelope: EnvelopeAnalysis | null,
  calibration: Calibration,
  reading: TranscriptReading,
  borderlineRatio = BORDERLINE_RATIO,
): { verdict: SoundVerdict; reason: DecisionReason } {
  if (envelope === null || envelope.voicedMs <= 0) return { verdict: 'NO_SOUND', reason: 'NO_SOUND' };
  const length = soundLengthMs(envelope);
  const high = calibration.thresholdMs * (1 + borderlineRatio);
  const low = calibration.thresholdMs * (1 - borderlineRatio);

  // Signal 1 (primary): one clearly long sound.
  if (length > high) return { verdict: 'REPEATED', reason: 'LONG_SOUND' };

  // Signal 2 (secondary): several bursts of the same word.
  if (envelope.bursts >= 2) {
    if (reading.repeats >= 2) return { verdict: 'REPEATED', reason: 'REPEATED_BURSTS' };
    // Whisper often writes "oui oui" as "Oui": the bursts may be the word twice,
    // or a noise and the word. Unless other words explain them, don't guess.
    if (!reading.extraWords) return { verdict: 'BORDERLINE', reason: 'BURSTS_UNCONFIRMED' };
  }

  if (length >= low) return { verdict: 'BORDERLINE', reason: 'NEAR_THRESHOLD' };
  if (reading.repeats >= 2 || reading.elongated) return { verdict: 'BORDERLINE', reason: 'TRANSCRIPT_DISAGREES' };
  return { verdict: 'SIMPLE', reason: 'SHORT_SOUND' };
}

export function decideAnswer(input: DecideAnswerInput): AnswerDecision {
  const calibration = input.calibration ?? DEFAULT_CALIBRATION;
  const reading = readTranscript(input.transcript);
  const evidence = (reason: DecisionReason, verdict: SoundVerdict | null = null): DecisionEvidence => ({
    reason,
    word: reading.word,
    verdict,
    soundMs: input.envelope ? soundLengthMs(input.envelope) : 0,
    voicedMs: input.envelope?.voicedMs ?? 0,
    bursts: input.envelope?.bursts ?? 0,
    thresholdMs: calibration.thresholdMs,
    transcriptRepeats: reading.repeats,
    transcriptElongated: reading.elongated,
  });

  if (input.role !== 'TIREUR') return { kind: 'UNKNOWN', evidence: evidence('NOT_TIREUR') };
  if (reading.rewind !== null) return { kind: 'REWIND', count: reading.rewind, evidence: evidence('REWIND') };
  if (reading.word === null) return { kind: 'UNKNOWN', evidence: evidence('NO_ANSWER_WORD') };

  const allowed = new Set(input.allowedClasses);
  if (reading.word === 'JE_NE_SAIS_PAS') {
    return allowed.has('JE_NE_SAIS_PAS')
      ? { kind: 'ANSWER', label: CANONICAL_LABELS.JE_NE_SAIS_PAS, evidence: evidence('NO_REPEATED_FORM') }
      : { kind: 'UNKNOWN', evidence: evidence('NOT_ALLOWED') };
  }

  const simple: 'OUI' | 'NON' = reading.word;
  const repeated: 'OUI_REPETE' | 'NON_REPETE' = reading.word === 'OUI' ? 'OUI_REPETE' : 'NON_REPETE';
  const simpleLabel = CANONICAL_LABELS[simple];
  const repeatedLabel = CANONICAL_LABELS[repeated];
  const simpleOk = allowed.has(simple);
  const repeatedOk = allowed.has(repeated);

  // The sound only chooses between classes the prompt allows.
  if (!simpleOk && !repeatedOk) return { kind: 'UNKNOWN', evidence: evidence('NOT_ALLOWED') };
  if (!repeatedOk) return { kind: 'ANSWER', label: simpleLabel, evidence: evidence('ONLY_SIMPLE_ALLOWED') };
  if (!simpleOk) return { kind: 'ANSWER', label: repeatedLabel, evidence: evidence('ONLY_REPEATED_ALLOWED') };

  const { verdict, reason } = classifySound(input.envelope, calibration, reading, input.borderlineRatio);
  if (verdict === 'SIMPLE') return { kind: 'ANSWER', label: simpleLabel, evidence: evidence(reason, verdict) };
  if (verdict === 'REPEATED') return { kind: 'ANSWER', label: repeatedLabel, evidence: evidence(reason, verdict) };
  return { kind: 'CONFIRM', options: [simpleLabel, repeatedLabel], evidence: evidence(reason, verdict) };
}
