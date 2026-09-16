import { describe, expect, it } from 'vitest';
import { INTENT_THRESHOLDS, jaroWinkler, matchIntent } from '../src/index';
import type { Intent, IntentContext, Prompt } from '../src/index';

const MINI_NAMES = ['ADAM', 'CAÏN', 'ABRAHAM', 'ABRAM', 'ISMAËL', 'ISAAC', 'JOSUE', 'DAVID', 'JEROBOAM', 'ESDRAS', 'JESUS-CHRIST', 'JACQUES', 'JACQUES'];
const PATH = [
  { index: 0, text: 'ANCIEN' },
  { index: 1, text: 'HOMME' },
  { index: 2, text: 'PENTATEUQUE' },
];

const prompt = (text: string, kind: Prompt['kind'] = 'CHILD'): Prompt => ({ promptNodeId: 'p', atNodeId: 'a', text, kind, answerClasses: kind === 'CHILD' ? ['OUI', 'NON'] : [] });

const tireur = (answerLabels: string[] = ['OUI', 'NON']): IntentContext => ({ role: 'TIREUR', prompt: prompt('HOMME', 'SPINE'), answerLabels, knownNames: MINI_NAMES, path: PATH });

const decouvreur = (promptText: string | null, knownNames: string[] = MINI_NAMES): IntentContext => ({
  role: 'DECOUVREUR',
  prompt: promptText === null ? null : prompt(promptText),
  answerLabels: [],
  knownNames,
  path: PATH,
});

type Case = [string, IntentContext, Intent['type'], Record<string, unknown>?];

const S_LABELS = ['OUI', 'OUIOUIOUI', 'NON'];
const PENT_LABELS = ['OUI', 'NON', 'NONONONON'];
const HOMME_LABELS = ['OUI', 'OUIOUIOUI', 'JE NE SAIS PAS'];

const CASES: Case[] = [
  // ANSWER
  ['oui', tireur(), 'ANSWER', { label: 'OUI' }],
  ['Oui !', tireur(), 'ANSWER', { label: 'OUI' }],
  ['ouais', tireur(), 'ANSWER', { label: 'OUI' }],
  ['exact', tireur(), 'ANSWER', { label: 'OUI' }],
  ["c'est ça", tireur(), 'ANSWER', { label: 'OUI' }],
  ['Tout à fait.', tireur(), 'ANSWER', { label: 'OUI' }],
  ['euh oui', tireur(), 'ANSWER', { label: 'OUI' }],
  ['non', tireur(), 'ANSWER', { label: 'NON' }],
  ['nan', tireur(), 'ANSWER', { label: 'NON' }],
  ['Pas du tout', tireur(), 'ANSWER', { label: 'NON' }],
  ['oui oui', tireur(S_LABELS), 'ANSWER', { label: 'OUIOUIOUI' }],
  ['ouioui', tireur(S_LABELS), 'ANSWER', { label: 'OUIOUIOUI' }],
  ['oui oui oui oui', tireur(S_LABELS), 'ANSWER', { label: 'OUIOUIOUI' }],
  ['oui', tireur(S_LABELS), 'ANSWER', { label: 'OUI' }],
  ['non non', tireur(PENT_LABELS), 'ANSWER', { label: 'NONONONON' }],
  ['nonono', tireur(PENT_LABELS), 'ANSWER', { label: 'NONONONON' }],
  ['non', tireur(PENT_LABELS), 'ANSWER', { label: 'NON' }],
  ['je ne sais pas', tireur(HOMME_LABELS), 'ANSWER', { label: 'JE NE SAIS PAS' }],
  ['Je sais pas', tireur(HOMME_LABELS), 'ANSWER', { label: 'JE NE SAIS PAS' }],
  ['chais pas', tireur(HOMME_LABELS), 'ANSWER', { label: 'JE NE SAIS PAS' }],
  ['oui oui', tireur(), 'UNKNOWN'],
  ['je ne sais pas', tireur(), 'UNKNOWN'],
  ['oui non', tireur(), 'UNKNOWN'],
  ['euh attends', tireur(), 'UNKNOWN'],
  // REWIND
  ['question', tireur(), 'REWIND', { count: 1 }],
  ['question question', tireur(), 'REWIND', { count: 2 }],
  ['Question, question, question !', tireur(), 'REWIND', { count: 3 }],
  ['question question question question', tireur(), 'UNKNOWN'],
  // BACK
  ['retour', decouvreur('LIE A ADAM'), 'BACK', { stepIndex: undefined }],
  ['question précédente', decouvreur('LIE A ADAM'), 'BACK', { stepIndex: 2 }],
  ['on revient à homme', decouvreur('LIE A ADAM'), 'BACK', { stepIndex: 1 }],
  ['Revenir au Pentateuque', decouvreur('LIE A ADAM'), 'BACK', { stepIndex: 2 }],
  // ASK
  ["Est-ce que c'est dans le Pentateuque ?", decouvreur('PENTATEUQUE'), 'ASK'],
  ["C'est un homme ?", decouvreur('HOMME'), 'ASK'],
  ['Le meurtrier ?', decouvreur('Le meurtrier'), 'ASK'],
  ['première classe ?', decouvreur('CLASSE 1'), 'ASK'],
  ['1ère classe', decouvreur('CLASSE 1'), 'ASK'],
  ['classe 1', decouvreur('1ère classe'), 'ASK'],
  ['Tome un ?', decouvreur('TOME 1'), 'ASK'],
  ['tome 1', decouvreur('TOME 1'), 'ASK'],
  ['le premier ?', decouvreur('LE PREMIER'), 'ASK'],
  ['1er ?', decouvreur('LE PREMIER'), 'ASK'],
  ['second ?', decouvreur('Le 2ème'), 'ASK'],
  ['le deuxième', decouvreur('2eme'), 'ASK'],
  ['Lié à Adam ?', decouvreur('LIE A ADAM'), 'ASK'],
  ["Fils d'Agar ?", decouvreur("FILS D'AGAR"), 'ASK'],
  ['Pentatheuque', decouvreur('PENTATEUQUE'), 'ASK'],
  ['deuxième classe', decouvreur('CLASSE 1'), 'UNKNOWN'],
  ["C'est un homme ?", decouvreur('Premier homme'), 'UNKNOWN'],
  // GUESS
  ['Caïn !', decouvreur('Le meurtrier'), 'GUESS', { name: 'CAÏN' }],
  ['Kaïn', decouvreur('Le meurtrier'), 'GUESS', { name: 'CAÏN' }],
  ["je pense que c'est Isaac", decouvreur(null), 'GUESS', { name: 'ISAAC' }],
  ["C'est David !", decouvreur('LIE A ADAM'), 'GUESS', { name: 'DAVID' }],
  ['Est-ce Abram ?', decouvreur('plus connu'), 'GUESS', { name: 'ABRAM' }],
  ['Abraham', decouvreur('plus connu'), 'GUESS', { name: 'ABRAHAM' }],
  ['Jésus Christ', decouvreur('le sauveur'), 'GUESS', { name: 'JESUS-CHRIST' }],
  ['Adam !', decouvreur('LIE A ADAM'), 'GUESS', { name: 'ADAM' }],
  ['Jacques', decouvreur(null), 'GUESS', { name: 'JACQUES' }],
  ["c'est Ben-Ammi", decouvreur(null, ['MOAB', 'BEN-AMMI']), 'GUESS', { name: 'BEN-AMMI' }],
  ['On !', decouvreur(null, ['ON', 'DAN']), 'GUESS', { name: 'ON' }],
  // UNKNOWN
  ['euh attends', decouvreur('LIE A ADAM'), 'UNKNOWN'],
  ['', decouvreur('LIE A ADAM'), 'UNKNOWN'],
  ['banane', decouvreur('LIE A ADAM'), 'UNKNOWN'],
  ['oui', decouvreur('LIE A ADAM'), 'UNKNOWN'],
  ['question', decouvreur('LIE A ADAM'), 'UNKNOWN'],
  ['jischvé', decouvreur(null, ['JISCHVA', 'JISCHVI']), 'UNKNOWN'],
  ['on est dans les rois', decouvreur(null, ['ON', 'DAN']), 'UNKNOWN'],
];

describe('matchIntent', () => {
  it('has at least 40 French utterances', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)('%j (%#)', (utterance, ctx, type, fields) => {
    const intent = matchIntent(utterance, ctx);
    expect(intent.type, JSON.stringify(intent)).toBe(type);
    if (fields) {
      for (const [k, v] of Object.entries(fields)) expect((intent as Record<string, unknown>)[k], k).toEqual(v);
    }
    if (intent.type === 'ASK' || intent.type === 'GUESS') {
      expect(intent.confidence).toBeGreaterThan(0);
      expect(intent.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('a single oui never maps to a repeated label, even when it is the only OUI-like label', () => {
    expect(matchIntent('oui', tireur(['OUIOUIOUI', 'NON']))).toEqual({ type: 'UNKNOWN' });
  });

  it('exports thresholds and a Jaro-Winkler score', () => {
    expect(INTENT_THRESHOLDS.ask).toBeGreaterThan(0);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('', 'abc')).toBe(0);
  });
});
