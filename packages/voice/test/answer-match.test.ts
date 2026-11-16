import { describe, expect, it } from 'vitest';
import { ANSWER_MATCH, answerKey, answerSimilarity, matchClosedSet, readTranscript, syllables } from '../src';

describe('syllables', () => {
  it('counts runs of vowels: every word of this vocabulary but "question" is one', () => {
    expect(syllables(answerKey('oui'))).toBe(1);
    expect(syllables(answerKey('non'))).toBe(1);
    expect(syllables(answerKey('ouais'))).toBe(1);
    expect(syllables(answerKey('question'))).toBe(2);
  });
});

describe('answerKey', () => {
  it('folds the mis-writes of a short "oui" onto one key', () => {
    const oui = answerKey('oui');
    for (const form of ['oui', 'Oui', 'OUI', 'hui', 'Hui', 'wi', 'Wi', 'ouii', 'ouiii', 'houi', 'ui']) {
      expect(answerKey(form), form).toBe(oui);
    }
  });

  it('folds the mis-writes of "question"', () => {
    const question = answerKey('question');
    for (const form of ['question', 'Question', 'kestion', 'Kestion']) expect(answerKey(form), form).toBe(question);
  });

  it('keeps a held "non" and its spelling variants together', () => {
    expect(answerKey('nonnn')).toBe(answerKey('non'));
    expect(answerKey('nooon')).toBe(answerKey('non'));
  });

  it('drops a mute e only after a consonant, so "Noé" stays a name', () => {
    expect(answerKey('exacte')).toBe(answerKey('exact'));
    // Dropping it made "Noé" into "no", which scored 0.91 against "non" and
    // answered NON for a Tireur who had said nothing of the sort.
    expect(answerKey('noe')).toBe('noe');
    expect(answerSimilarity('noe', 'non')).toBe(0);
  });

  it('does not fold words that only look alike', () => {
    expect(answerKey('bon')).not.toBe(answerKey('non'));
    expect(answerKey('lui')).not.toBe(answerKey('oui'));
    expect(answerKey('nous')).not.toBe(answerKey('oui'));
  });
});

describe('answerSimilarity', () => {
  it('a monosyllable with a different onset is not the same word', () => {
    // Each of these scores 0.778 against "non" on raw Jaro-Winkler, a hair
    // under the general threshold: the onset rule is what makes them 0.
    for (const word of ['bon', 'son', 'ton', 'mon', 'don']) {
      expect(answerSimilarity(word, 'non'), word).toBe(0);
    }
    expect(answerSimilarity('lui', 'oui')).toBe(0);
    expect(answerSimilarity('nous', 'ouais')).toBe(0);
    expect(answerSimilarity('louis', 'ouais')).toBe(0);
  });

  it('a monosyllable with the right onset must still clear the higher bar', () => {
    expect(answerSimilarity('ouest', 'ouais')).toBeLessThan(ANSWER_MATCH.shortScore);
    expect(answerSimilarity('ouest', 'ouais')).toBe(0);
    expect(answerSimilarity('ouh', 'oui')).toBeGreaterThanOrEqual(ANSWER_MATCH.shortScore);
  });

  it('an exact spelling always beats a phonetic match', () => {
    expect(answerSimilarity('oui', 'oui')).toBe(1);
    expect(answerSimilarity('hui', 'oui')).toBeLessThan(1);
    expect(answerSimilarity('hui', 'oui')).toBeGreaterThan(0.9);
  });

  it('is 0 for an empty side', () => {
    expect(answerSimilarity('', 'oui')).toBe(0);
    expect(answerSimilarity('oui', '')).toBe(0);
    expect(answerSimilarity('...', 'oui')).toBe(0);
  });
});

describe('matchClosedSet', () => {
  const value = (text: string) => matchClosedSet(text)?.value ?? null;

  it('reads the four things a Tireur may say, however they are written', () => {
    for (const text of ['Oui', 'Oui.', 'Ouais', 'Hui', 'Wi', 'Ouh', 'Houi', 'Ouaip', 'Exact']) {
      expect(value(text), text).toBe('OUI');
    }
    for (const text of ['Non', 'Nan', 'No', 'Nonn', 'N’ont', 'Pas du tout']) {
      expect(value(text), text).toBe('NON');
    }
    for (const text of ['Je ne sais pas', 'J’sais pas', 'Chais pas', 'Aucune idée']) {
      expect(value(text), text).toBe('JE_NE_SAIS_PAS');
    }
    for (const text of ['Question', 'Questions', 'Gestion', 'Kestion']) {
      expect(value(text), text).toBe('REWIND');
    }
  });

  it('refuses the short French words that sit next to oui and non', () => {
    for (const text of ['Bon', 'Son', 'Ton', 'Mon', 'Nom', 'Nous', 'Lui', 'Louis', 'Ouest', 'Oust', 'Long']) {
      expect(value(text), text).toBeNull();
    }
  });

  it('refuses the Découvreur’s words: a name is never an answer', () => {
    for (const text of ['Ancien', 'Homme', 'Pentateuque', 'Abraham', 'Absalom', 'Moïse', 'Noé', 'Onan', 'Revenir à Ancien']) {
      expect(value(text), text).toBeNull();
    }
  });

  it('refuses silence, filler and Whisper’s subtitle credits', () => {
    for (const text of ['', '...', 'Hmm', 'Euh', 'Ah', 'Merci.', 'Sous-titrage Société Radio-Canada', 'Au revoir.']) {
      expect(value(text), text).toBeNull();
    }
  });

  it('a word pulled out of a longer utterance clears the higher bar', () => {
    expect(value('Ah oui')).toBe('OUI');
    expect(value('Eh oui')).toBe('OUI');
    // Not an answer with filler around it: a different sentence altogether.
    expect(value('Je vais poser une autre question au joueur suivant')).toBeNull();
  });

  it('counts a repeated "question" so the rewind knows how far to go', () => {
    expect(matchClosedSet('Question question')?.count).toBe(2);
    expect(matchClosedSet('Question, question.')?.count).toBe(2);
  });

  it('says nothing when two answers are too close to tell apart', () => {
    // Nothing in this vocabulary collides today; the rule is what keeps a new
    // alias from quietly turning a near-tie into a branch of the book.
    const tie = matchClosedSet('oui', {
      candidates: [
        { value: 'OUI', aliases: ['oui'] },
        { value: 'NON', aliases: ['oui'] },
      ],
    });
    expect(tie).toBeNull();
  });
});

describe('readTranscript with the closed set', () => {
  it('understands a mangled answer the exact spellings miss', () => {
    expect(readTranscript('Hui')).toMatchObject({ word: 'OUI', via: 'closed-set' });
    expect(readTranscript('Wi')).toMatchObject({ word: 'OUI', via: 'closed-set' });
    expect(readTranscript('Gestion')).toMatchObject({ rewind: 1, via: 'closed-set' });
  });

  it('still answers the exact spellings through the strict pass', () => {
    expect(readTranscript('Oui.')).toMatchObject({ word: 'OUI', via: 'strict' });
    expect(readTranscript('Non')).toMatchObject({ word: 'NON', via: 'strict' });
    expect(readTranscript('Question')).toMatchObject({ rewind: 1, via: 'strict' });
  });

  it('reads nothing into a name or into silence', () => {
    expect(readTranscript('Absalom')).toMatchObject({ word: null, rewind: null, via: 'none' });
    expect(readTranscript('')).toMatchObject({ word: null, rewind: null, via: 'none' });
  });

  it('reports the other words, which explain an extra burst in the sound', () => {
    expect(readTranscript('Ah hui')).toMatchObject({ word: 'OUI', extraWords: true, via: 'closed-set' });
  });
});
