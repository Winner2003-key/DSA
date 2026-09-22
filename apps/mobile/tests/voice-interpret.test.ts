/**
 * What a spoken turn means (brief S7b "Tests"): the Découvreur's words through the
 * core matcher, the Tireur's through decideAnswer with the recording's envelope.
 */
import { DEFAULT_CALIBRATION, type Calibration } from '@dsa/voice';

import { interpretDecouvreur, interpretTireur, soundVerdict } from '@/speech/interpret';
import { cleanTranscript } from '@/speech/use-voice-turn';
import type { GameState, PathEntry } from '@/services/types';
import { envelopeOf, recordingOf, SILENCE_DB, VOICE_DB } from './fake-recorder';

const NAMES = ['ABSALOM', 'ABRAHAM', 'ABRAM', 'ADAM', 'CAÏN', 'DAVID', 'JACQUES', 'JEROBOAM'];

function entry(step_index: number, text: string, answer_label = 'OUI'): PathEntry {
  return { step_index, node_id: `n${step_index}`, text, answer_label, prompt_kind: 'SPINE', node_type: 'QUESTION', target_text: null };
}

function stateAt(promptText: string | null, path: PathEntry[] = []): GameState {
  return {
    status: 'PLAYING',
    mode: 'AI_TIREUR',
    awaiting: 'QUESTION',
    prompt: promptText ? { node_id: 'p', text: promptText, node_type: 'QUESTION', answer_classes: ['OUI', 'NON'] } : null,
    dead_end: false,
    pending_guess: null,
    path,
    players: [],
    settings: { input_mode: 'VOICE', timed: false, think_seconds: null, play_seconds: null, max_redraws: 2 },
    tireur_ready: true,
    room_code: null,
    timed: false,
    phase: 'PLAYING',
    think_ends_at: null,
    play_ends_at: null,
    server_now: '2026-09-17T12:00:00.000Z',
    redraws_used: 0,
    redraws_left: 2,
  };
}

describe('Découvreur by voice', () => {
  it('"Ancien" asks the current question', () => {
    expect(interpretDecouvreur('Ancien ?', stateAt('ANCIEN'), NAMES)).toEqual({ kind: 'ASK' });
    expect(interpretDecouvreur('Lié à Adam ?', stateAt('LIE A ADAM'), NAMES)).toEqual({ kind: 'ASK' });
    // A longer phrasing is still understood (§10).
    expect(interpretDecouvreur('Est-ce que c’est dans le Pentateuque ?', stateAt('PENTATEUQUE'), NAMES)).toEqual({ kind: 'ASK' });
  });

  it('"Absalom !" calls the name', () => {
    expect(interpretDecouvreur('Absalom !', stateAt('LIE A DAVID'), NAMES)).toEqual({ kind: 'GUESS', name: 'ABSALOM' });
    expect(interpretDecouvreur('Caïn.', stateAt(null), NAMES)).toEqual({ kind: 'GUESS', name: 'CAÏN' });
  });

  it('"revenir à Pentateuque" goes back to that step of the path', () => {
    const path = [entry(0, 'ANCIEN'), entry(1, 'HOMME'), entry(2, 'PENTATEUQUE', 'NON'), entry(3, 'LES 3 PREMIERS', 'NON')];
    expect(interpretDecouvreur('Revenir à Pentateuque.', stateAt(null, path), NAMES)).toEqual({ kind: 'BACK', stepIndex: 2 });
    // No recognisable question: the list is opened instead.
    expect(interpretDecouvreur('Revenir en arrière', stateAt(null, path), NAMES)).toEqual({ kind: 'BACK', stepIndex: null });
  });

  it('noise, silence or a different question is UNKNOWN', () => {
    for (const text of ['', '...', 'Euh', 'Sous-titrage ST’ 501', 'Homme ?']) {
      expect(interpretDecouvreur(text, stateAt('ANCIEN'), NAMES)).toEqual({ kind: 'UNKNOWN' });
    }
    // Nothing to go back to at the first question.
    expect(interpretDecouvreur('revenir à Ancien', stateAt('ANCIEN'), NAMES)).toEqual({ kind: 'UNKNOWN' });
  });
});

describe('Tireur by voice', () => {
  const both = ['OUI', 'NON', 'OUI_REPETE'] as const;

  it('a long envelope + "oui" is OUIOUIOUI; a short one is OUI', () => {
    const long = interpretTireur({ transcript: 'Oui.', envelope: recordingOf(1200).envelope, calibration: null, answerClasses: [...both] });
    expect(long).toMatchObject({ kind: 'ANSWER', label: 'OUIOUIOUI' });
    const short = interpretTireur({ transcript: 'Oui.', envelope: recordingOf(300).envelope, calibration: null, answerClasses: [...both] });
    expect(short).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
  });

  it('a borderline envelope asks with the two confirm buttons', () => {
    // Default threshold 650 ms, ±15 %: 650 ms is right on it.
    const decision = interpretTireur({ transcript: 'Oui', envelope: recordingOf(650).envelope, calibration: null, answerClasses: [...both] });
    expect(decision).toMatchObject({ kind: 'CONFIRM', options: ['OUI', 'OUIOUIOUI'] });
  });

  it('uses the stored calibration', () => {
    const slow: Calibration = { thresholdMs: 1400, shortMedianMs: 600, longMedianMs: 2200, quality: 'good' };
    const decision = interpretTireur({ transcript: 'oui', envelope: recordingOf(1000).envelope, calibration: slow, answerClasses: [...both] });
    expect(decision).toMatchObject({ kind: 'ANSWER', label: 'OUI' });
  });

  it('"question question" rewinds two questions', () => {
    const decision = interpretTireur({ transcript: 'Question, question.', envelope: recordingOf(900).envelope, calibration: null, answerClasses: ['OUI', 'NON'] });
    expect(decision).toMatchObject({ kind: 'REWIND', count: 2 });
  });

  it('a name call takes only OUI or NON, never a rewind', () => {
    expect(interpretTireur({ transcript: 'oui', envelope: recordingOf(1500).envelope, calibration: null, answerClasses: null })).toMatchObject({
      kind: 'ANSWER',
      label: 'OUI',
    });
    expect(interpretTireur({ transcript: 'question', envelope: [], calibration: null, answerClasses: null }).kind).toBe('UNKNOWN');
  });

  it('noise is UNKNOWN', () => {
    expect(interpretTireur({ transcript: 'Merci d’avoir regardé', envelope: recordingOf(400).envelope, calibration: null, answerClasses: [...both] }).kind).toBe(
      'UNKNOWN',
    );
  });
});

describe('calibration live test and helpers', () => {
  it('judges the sound alone', () => {
    expect(soundVerdict(recordingOf(300).envelope, DEFAULT_CALIBRATION)).toBe('SIMPLE');
    expect(soundVerdict(recordingOf(1200).envelope, DEFAULT_CALIBRATION)).toBe('REPEATED');
    expect(soundVerdict(recordingOf(650).envelope, DEFAULT_CALIBRATION)).toBe('BORDERLINE');
    expect(soundVerdict(envelopeOf([[1500, SILENCE_DB]]), DEFAULT_CALIBRATION)).toBe('NO_SOUND');
    const oui3 = envelopeOf([[500, SILENCE_DB], [250, VOICE_DB], [200, SILENCE_DB], [250, VOICE_DB], [200, SILENCE_DB], [250, VOICE_DB], [500, SILENCE_DB]]);
    expect(soundVerdict(oui3, DEFAULT_CALIBRATION)).toBe('REPEATED');
  });

  it('cleans the transcript for "J’ai entendu"', () => {
    expect(cleanTranscript(' Ancien ? ')).toBe('Ancien');
    expect(cleanTranscript('« Revenir à Pentateuque. »')).toBe('Revenir à Pentateuque');
  });
});
