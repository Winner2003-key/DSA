import { describe, expect, it } from 'vitest';
import type { AnswerClass } from '@dsa/core';
import { CANONICAL_LABELS, DEFAULT_CALIBRATION, analyzeEnvelope, calibrate, decideAnswer, readTranscript } from '../src';
import type { Calibration, EnvelopeAnalysis } from '../src';
import { SILENCE_DB, VOICE_DB, spoken } from './helpers';

// HOMME ? offers OUI, OUIOUIOUI, JE NE SAIS PAS, NON; PENTATEUQUE ? offers OUI, NON, NONONONON.
const HOMME: AnswerClass[] = ['OUI', 'OUI_REPETE', 'JE_NE_SAIS_PAS', 'NON'];
const PENTATEUQUE: AnswerClass[] = ['OUI', 'NON', 'NON_REPETE'];
const CHILD: AnswerClass[] = ['OUI', 'NON'];

const one = (ms: number): EnvelopeAnalysis => analyzeEnvelope(spoken([[ms, VOICE_DB]]));
const bursts = (...ms: number[]): EnvelopeAnalysis =>
  analyzeEnvelope(spoken(ms.flatMap((d, i) => (i === 0 ? [[d, VOICE_DB]] : [[200, SILENCE_DB], [d, VOICE_DB]]) as [number, number][])));

function decide(allowedClasses: AnswerClass[], transcript: string, envelope: EnvelopeAnalysis | null, calibration: Calibration = DEFAULT_CALIBRATION) {
  return decideAnswer({ allowedClasses, transcript, envelope, calibration, role: 'TIREUR' });
}

describe('decideAnswer — the word comes from the transcript, the form from the sound', () => {
  it('a short "Oui." is OUI', () => {
    expect(decide(HOMME, 'Oui.', one(300))).toMatchObject({ kind: 'ANSWER', label: 'OUI', evidence: { reason: 'SHORT_SOUND' } });
  });

  it('a held "ouiiii" written "Oui." by Whisper is OUIOUIOUI (the sound decides)', () => {
    expect(decide(HOMME, 'Oui.', one(900))).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI', evidence: { reason: 'LONG_SOUND', verdict: 'REPEATED' } });
  });

  it('a short "Non." is NON, a held one is NONONONON', () => {
    expect(decide(PENTATEUQUE, 'Non.', one(280))).toMatchObject({ kind: 'ANSWER', label: 'NON' });
    expect(decide(PENTATEUQUE, 'Non !', one(1000))).toMatchObject({ kind: 'ANSWER', label: 'NONONONON' });
  });

  it('"oui oui oui" in 3 bursts is OUIOUIOUI (secondary signal)', () => {
    expect(decide(HOMME, 'Oui, oui, oui.', bursts(250, 250, 250))).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI', evidence: { reason: 'REPEATED_BURSTS', bursts: 3 } });
  });

  it('two bursts but a single "Oui" in the transcript: don\'t guess, CONFIRM', () => {
    expect(decide(HOMME, 'Oui.', bursts(250, 250))).toMatchObject({ kind: 'CONFIRM', options: ['OUI', 'OUIOUIOUI'], evidence: { reason: 'BURSTS_UNCONFIRMED' } });
  });

  it('"Euh, oui." in two bursts: the extra word explains the burst, the length decides', () => {
    expect(decide(HOMME, 'Euh, oui.', bursts(250, 300))).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
  });

  it('a borderline length (within ±15 % of the threshold) gives CONFIRM', () => {
    const d = decide(HOMME, 'Oui.', one(650));
    expect(d).toEqual({ kind: 'CONFIRM', options: ['OUI', 'OUIOUIOUI'], evidence: expect.objectContaining({ reason: 'NEAR_THRESHOLD', verdict: 'BORDERLINE' }) });
    expect(decide(PENTATEUQUE, 'Non', one(600))).toMatchObject({ kind: 'CONFIRM', options: ['NON', 'NONONONON'] });
  });

  it('the ±15 % band is 552.5–747.5 ms for a 650 ms threshold', () => {
    expect(decide(HOMME, 'oui', one(600)).kind).toBe('CONFIRM');
    expect(decide(HOMME, 'oui', one(700)).kind).toBe('CONFIRM');
    expect(decide(HOMME, 'oui', one(550))).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
    expect(decide(HOMME, 'oui', one(750))).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI' });
  });

  it('uses the personal calibration threshold', () => {
    const slow = calibrate([one(500), one(550)], [one(1400), one(1500)]); // threshold 988
    expect(slow.thresholdMs).toBe(988);
    expect(decide(HOMME, 'Oui.', one(800), slow)).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
    expect(decide(HOMME, 'Oui.', one(800))).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI' });
  });

  it('no envelope (or no voice detected) with both forms allowed: CONFIRM', () => {
    expect(decide(HOMME, 'Oui.', null)).toMatchObject({ kind: 'CONFIRM', evidence: { reason: 'NO_SOUND' } });
    expect(decide(HOMME, 'Oui.', analyzeEnvelope([]))).toMatchObject({ kind: 'CONFIRM', evidence: { reason: 'NO_SOUND' } });
  });
});

describe('decideAnswer — the prompt limits the answer', () => {
  it('the prompt allows only OUI/NON, so the sound is ignored', () => {
    expect(decide(CHILD, 'Oui.', one(1500))).toMatchObject({ kind: 'ANSWER', label: 'OUI', evidence: { reason: 'ONLY_SIMPLE_ALLOWED' } });
    expect(decide(CHILD, 'oui oui oui', bursts(250, 250, 250))).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
    expect(decide(CHILD, 'Nonnn', one(650))).toMatchObject({ kind: 'ANSWER', label: 'NON' });
  });

  it('never returns a repeated class the prompt does not allow', () => {
    for (const ms of [200, 400, 600, 650, 800, 1200]) {
      for (const t of ['oui', 'ouiiii', 'oui oui oui', 'non', 'non non', 'nooon']) {
        const d = decide(CHILD, t, one(ms));
        if (d.kind === 'ANSWER') expect(['OUI', 'NON']).toContain(d.label);
        expect(d.kind).not.toBe('CONFIRM');
      }
    }
    // PENTATEUQUE has NONONONON but no OUIOUIOUI.
    expect(decide(PENTATEUQUE, 'Oui.', one(1200))).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
  });

  it('only the repeated form allowed: the word maps to it', () => {
    expect(decide(['OUI_REPETE', 'NON'], 'Oui.', one(300))).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI', evidence: { reason: 'ONLY_REPEATED_ALLOWED' } });
  });

  it('a word the prompt does not accept at all is UNKNOWN', () => {
    expect(decide(['OUI', 'OUI_REPETE'], 'Non.', one(300))).toMatchObject({ kind: 'UNKNOWN', evidence: { reason: 'NOT_ALLOWED' } });
    expect(decide(CHILD, 'Je ne sais pas.', one(900))).toMatchObject({ kind: 'UNKNOWN', evidence: { reason: 'NOT_ALLOWED' } });
  });

  it('JE NE SAIS PAS has no repeated form', () => {
    expect(decide(HOMME, 'Je ne sais pas.', one(1200))).toMatchObject({ kind: 'ANSWER', label: 'JE NE SAIS PAS' });
    expect(decide(HOMME, 'Je sais pas', null)).toMatchObject({ kind: 'ANSWER', label: 'JE NE SAIS PAS' });
  });

  it('results are always canonical book labels', () => {
    const labels = new Set(Object.values(CANONICAL_LABELS));
    expect([...labels]).toEqual(['OUI', 'OUIOUIOUI', 'NON', 'NONONONON', 'JE NE SAIS PAS']);
    for (const [t, ms] of [['ouais', 300], ['OUAIS OUAIS', 900], ['nan', 300], ['non non non', 1100]] as const) {
      const d = decide([...HOMME, 'NON_REPETE'], t, one(ms));
      if (d.kind === 'ANSWER') expect(labels.has(d.label)).toBe(true);
      if (d.kind === 'CONFIRM') d.options.forEach((l) => expect(labels.has(l)).toBe(true));
    }
  });
});

describe('decideAnswer — transcript hints are supporting evidence only', () => {
  it('"ouiii" with a short sound is not taken as OUIOUIOUI: CONFIRM', () => {
    expect(decide(HOMME, 'Ouiii', one(300))).toMatchObject({ kind: 'CONFIRM', evidence: { reason: 'TRANSCRIPT_DISAGREES', transcriptElongated: true } });
  });

  it('"oui oui oui" said fast as one short burst: CONFIRM', () => {
    expect(decide(HOMME, 'oui oui oui', one(350))).toMatchObject({ kind: 'CONFIRM', evidence: { transcriptRepeats: 3 } });
  });

  it('"nooon" with a long sound is NONONONON (both agree)', () => {
    expect(decide(PENTATEUQUE, 'Nooon !', one(1000))).toMatchObject({ kind: 'ANSWER', label: 'NONONONON' });
  });
});

describe('decideAnswer — other outcomes', () => {
  it('"question" ×N is REWIND', () => {
    expect(decide(HOMME, 'Question.', one(400))).toMatchObject({ kind: 'REWIND', count: 1 });
    expect(decide(HOMME, 'Question, question.', bursts(400, 400))).toMatchObject({ kind: 'REWIND', count: 2 });
    expect(decide(HOMME, 'question question question', null)).toMatchObject({ kind: 'REWIND', count: 3 });
  });

  it('no answer word is UNKNOWN', () => {
    expect(decide(HOMME, '', one(300))).toMatchObject({ kind: 'UNKNOWN', evidence: { reason: 'NO_ANSWER_WORD' } });
    expect(decide(HOMME, 'Sous-titres réalisés par la communauté d’Amara.org', one(300))).toMatchObject({ kind: 'UNKNOWN' });
    expect(decide(HOMME, 'oui non', bursts(300, 300))).toMatchObject({ kind: 'UNKNOWN' });
  });

  it('only the Tireur answers', () => {
    expect(decideAnswer({ allowedClasses: HOMME, transcript: 'Oui', envelope: one(300), calibration: DEFAULT_CALIBRATION, role: 'DECOUVREUR' })).toMatchObject({
      kind: 'UNKNOWN',
      evidence: { reason: 'NOT_TIREUR' },
    });
  });

  it('calibration is optional (defaults apply)', () => {
    expect(decideAnswer({ allowedClasses: HOMME, transcript: 'Oui', envelope: one(900), role: 'TIREUR' })).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI', evidence: { thresholdMs: 650 } });
  });
});

describe('readTranscript', () => {
  it.each([
    ['Oui.', { word: 'OUI', repeats: 1, elongated: false, extraWords: false }],
    ['Ouiiii !', { word: 'OUI', repeats: 1, elongated: true }],
    ['Oui oui oui', { word: 'OUI', repeats: 3 }],
    ['ouioui', { word: 'OUI', repeats: 2 }],
    ['Ouais, ouais.', { word: 'OUI', repeats: 2 }],
    ['Nooon', { word: 'NON', elongated: true }],
    ['Nonnn.', { word: 'NON', elongated: true }],
    ['Non non', { word: 'NON', repeats: 2 }],
    ['Euh… oui.', { word: 'OUI', extraWords: true }],
    ['Oui, c’est ça.', { word: 'OUI' }],
    ['Je crois que oui', { word: 'OUI', extraWords: true }],
    ['Je ne sais pas', { word: 'JE_NE_SAIS_PAS' }],
    ['Question question', { rewind: 2, word: null }],
    ['Bonjour tout le monde', { word: null, rewind: null }],
  ] as const)('%s', (text, expected) => {
    expect(readTranscript(text)).toMatchObject(expected);
  });
});
