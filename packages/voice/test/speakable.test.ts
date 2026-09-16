import { describe, expect, it } from 'vitest';
import { LEXICON_FR, cardinalFr, ordinalFr, readOrdinalToken, speakableAnswer, speakableName, speakablePrompt, speakableText } from '../src';
import type { PronunciationLexicon } from '../src';

describe('speakablePrompt — direct questions (§10)', () => {
  it.each([
    ['ANCIEN', 'Ancien ?'],
    ['HOMME', 'Homme ?'],
    ['PENTATEUQUE', 'Pentateuque ?'],
    ['LIE A DAVID', 'Lié à David ?'],
    ['Le meurtrier', 'Le meurtrier ?'],
    ['LIVRE DE SAMUEL', 'Livre de Samuel ?'],
    ['LES ROIS', 'Les rois ?'],
    ['EVANGILES', 'Évangiles ?'],
    ['LES PETITS PROPHETES', 'Les petits prophètes ?'],
    ['ACTES DES APOTRES', 'Actes des Apôtres ?'],
    ['EPITRES', 'Épîtres ?'],
    ['LIVRE DE CHRONIQUES', 'Livre de Chroniques ?'],
    ['LIVRE DE NEHEMIE', 'Livre de Néhémie ?'],
    ['LIE A MOISE', 'Lié à Moïse ?'],
    ['LIE A ESAU', 'Lié à Ésaü ?'],
    ['LIE A SAUL', 'Lié à Saül ?'],
    ['LES FILS D\'ISRAEL', 'Les fils d\'Israël ?'],
    ['GENERATION DE NOE', 'Génération de Noé ?'],
    ['TOME 1', 'Tome un ?'],
    ['TOME 3', 'Tome trois ?'],
    ['1ère classe', 'Première classe ?'],
    ['2ème classe', 'Deuxième classe ?'],
    ['2eme CLASSE', 'Deuxième classe ?'],
    ['1er', 'Premier ?'],
    ['1ER', 'Premier ?'],
    ['1ERE CLASSE', 'Première classe ?'],
    ['Régna sept jours', 'Régna sept jours ?'],
    ['PERE DE LA FOI', 'Père de la foi ?'],
    ['5eme', 'Cinquième ?'],
    ['LES 3 PREMIERS', 'Les trois premiers ?'],
    ['plus connu', 'Plus connu ?'],
    ['Le révolté', 'Le révolté ?'],
    ['Serviteur de MOÏSE', 'Serviteur de Moïse ?'],
    ['GRANDS-PERES', 'Grands-pères ?'],
    ['PENTATEUQUE (HOMMES)', 'Pentateuque hommes ?'],
  ])('%s → %s', (label, expected) => {
    expect(speakablePrompt(label)).toBe(expected);
  });

  it('removes "Est-ce" and a trailing question mark', () => {
    expect(speakablePrompt('Est-ce ANCIEN ?')).toBe('Ancien ?');
    expect(speakablePrompt('Est-ce un homme ?')).toBe('Homme ?');
    expect(speakablePrompt("Est-ce que c'est dans le Pentateuque ?")).toBe('Pentateuque ?');
    expect(speakablePrompt('est ce LES ROIS?')).toBe('Rois ?');
    expect(speakablePrompt('Lévitique ?')).toBe('Lévitique ?');
  });

  it('an empty label gives an empty string', () => {
    expect(speakablePrompt('  ? ')).toBe('');
  });

  it('never says "Est-ce"', () => {
    for (const label of ['ANCIEN', 'Est-ce HOMME', 'EST-CE QUE LIE A ADAM']) expect(speakablePrompt(label)).not.toMatch(/est-ce/i);
  });
});

describe('speakableAnswer', () => {
  it.each([
    ['OUI', 'Oui.'],
    ['NON', 'Non.'],
    ['OUIOUIOUI', 'Ouiiii !'],
    ['OUIOUIOUIOUI', 'Ouiiii !'],
    ['NONONONON', 'Nonnnn !'],
    ['NONONONO', 'Nonnnn !'],
    ['JE NE SAIS PAS', 'Je ne sais pas.'],
  ])('%s → %s', (label, expected) => {
    expect(speakableAnswer(label)).toBe(expected);
  });
});

describe('lexicon and numbers', () => {
  it('the lexicon is plain data with capital, accent-free keys', () => {
    const json = JSON.parse(JSON.stringify(LEXICON_FR)) as PronunciationLexicon;
    expect(json).toEqual(LEXICON_FR);
    for (const key of [...Object.keys(LEXICON_FR.words), ...Object.keys(LEXICON_FR.phrases)]) {
      expect(key).toMatch(/^[A-Z0-9]+( [A-Z0-9]+)*$/);
    }
    expect(LEXICON_FR.words).toMatchObject({ EVANGILES: 'Évangiles', PROPHETES: 'prophètes', GENERATION: 'génération', MOISE: 'Moïse', ESAU: 'Ésaü', SAUL: 'Saül', ISRAEL: 'Israël', NEHEMIE: 'Néhémie' });
    expect(LEXICON_FR.phrases['LIE A']).toBe('lié à');
  });

  it('an edited lexicon can be passed in', () => {
    const custom: PronunciationLexicon = { phrases: {}, words: { A: 'à', DAVID: 'Dâvid' } };
    expect(speakablePrompt('LIE A DAVID', custom)).toBe('Lie à Dâvid ?');
  });

  it('names: unlisted capitals become a name, listed ones get their accents', () => {
    expect(speakableName('ABSALOM')).toBe('Absalom');
    expect(speakableName('CAÏN')).toBe('Caïn');
    expect(speakableName('CAIN')).toBe('Caïn');
    expect(speakableName('BEN-AMMI')).toBe('Ben-Ammi');
    expect(speakableText('Père de NOE')).toBe('père de Noé');
  });

  it('cardinals and ordinals in French', () => {
    expect([1, 2, 17, 21, 71, 80, 91, 100, 200, 1000].map(cardinalFr)).toEqual(['un', 'deux', 'dix-sept', 'vingt et un', 'soixante et onze', 'quatre-vingts', 'quatre-vingt-onze', 'cent', 'deux cents', 'mille']);
    expect([1, 2, 3, 4, 5, 9, 11, 21].map((n) => ordinalFr(n))).toEqual(['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'neuvième', 'onzième', 'vingt et unième']);
    expect(ordinalFr(1, true)).toBe('première');
    expect(['1ERE', '1re', '2nd', '4e', '3èmes', 'abc'].map(readOrdinalToken)).toEqual(['première', 'première', 'second', 'quatrième', 'troisièmes', null]);
  });
});
