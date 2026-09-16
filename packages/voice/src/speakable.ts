// What TTS says (GRAPH_SPECIFICATION §10). The screen keeps the book spelling;
// speech gets a direct question with French accents and numbers in words.

import { answerClass, stripAccents } from '@dsa/core';
import { LEXICON_FR } from './lexicon.fr';
import type { PronunciationLexicon } from './lexicon.fr';
import { cardinalFr, readOrdinalToken } from './numbers.fr';

const WORD = /[\p{L}\p{N}]+/gu;

interface Piece {
  text: string;
  isWord: boolean;
}

function split(text: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    const index = m.index ?? 0;
    if (index > last) pieces.push({ text: text.slice(last, index), isWord: false });
    pieces.push({ text: m[0], isWord: true });
    last = index + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), isWord: false });
  return pieces;
}

const keyOf = (word: string) => stripAccents(word).toUpperCase();
const isAllCaps = (word: string) => /\p{Lu}/u.test(word) && word === word.toUpperCase();
const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

function speakWord(word: string, lexicon: PronunciationLexicon): string {
  const listed = lexicon.words[keyOf(word)];
  if (listed !== undefined) return listed;
  const ordinal = readOrdinalToken(word);
  if (ordinal !== null) return ordinal;
  if (/^\d+$/.test(word)) return cardinalFr(Number(word));
  // An unlisted word in capitals is a name ("DAVID" → "David"); anything else stays as written.
  return isAllCaps(word) ? titleCase(word) : word;
}

const phraseCache = new WeakMap<PronunciationLexicon, { words: string[]; value: string }[]>();

function phrasesOf(lexicon: PronunciationLexicon): { words: string[]; value: string }[] {
  let phrases = phraseCache.get(lexicon);
  if (!phrases) {
    phrases = Object.entries(lexicon.phrases)
      .map(([key, value]) => ({ words: key.split(' ').filter((w) => w !== ''), value }))
      .filter((p) => p.words.length > 0)
      .sort((a, b) => b.words.length - a.words.length);
    phraseCache.set(lexicon, phrases);
  }
  return phrases;
}

/** Rewrites a book label or clue into its speakable form, without the question mark. */
export function speakableText(text: string, lexicon: PronunciationLexicon = LEXICON_FR): string {
  const pieces = split(text.replace(/[()[\]{}]/g, ' '));
  const out: string[] = [];
  for (let i = 0; i < pieces.length; ) {
    const piece = pieces[i] as Piece;
    if (!piece.isWord) {
      out.push(piece.text);
      i++;
      continue;
    }
    // Phrases: consecutive words separated by plain spaces.
    const phrase = phrasesOf(lexicon).find((p) =>
      p.words.every((w, k) => {
        const word = pieces[i + 2 * k];
        const gap = pieces[i + 2 * k - 1];
        return word?.isWord === true && keyOf(word.text) === w && (k === 0 || (gap !== undefined && /^\s+$/.test(gap.text)));
      }),
    );
    if (phrase) {
      out.push(phrase.value);
      i += phrase.words.length * 2 - 1;
    } else {
      out.push(speakWord(piece.text, lexicon));
      i++;
    }
  }
  return out
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Est-ce que c'est dans le …", "Est-ce un …", "Est-ce …": the question is said directly.
const EST_CE = /^est[\s-]*ce\s+(?:que\s+|qu['’]\s*)?(?:c['’]\s*est\s+)?(?:(?:dans\s+)?(?:(?:une|un|les|le|la)\s+|l['’]\s*)|dans\s+)?/i;

/** The direct question for TTS: "LIE A DAVID" → "Lié à David ?", "ANCIEN" → "Ancien ?". */
export function speakablePrompt(text: string, lexicon: PronunciationLexicon = LEXICON_FR): string {
  const bare = text
    .trim()
    .replace(/[\s?!.…]+$/u, '')
    .replace(EST_CE, '')
    .trim();
  const spoken = speakableText(bare, lexicon);
  return spoken === '' ? '' : `${sentenceCase(spoken)} ?`;
}

/** A name as it should be said ("ABSALOM" → "Absalom", "MOISE" → "Moïse"). */
export function speakableName(name: string, lexicon: PronunciationLexicon = LEXICON_FR): string {
  return sentenceCase(speakableText(name, lexicon));
}

/** The spoken answer: OUI → "Oui.", OUIOUIOUI → "Ouiiii !" (a held sound), JE NE SAIS PAS → "Je ne sais pas." */
export function speakableAnswer(label: string, lexicon: PronunciationLexicon = LEXICON_FR): string {
  switch (answerClass(label)) {
    case 'OUI':
      return 'Oui.';
    case 'NON':
      return 'Non.';
    case 'OUI_REPETE':
      return 'Ouiiii !';
    case 'NON_REPETE':
      return 'Nonnnn !';
    case 'JE_NE_SAIS_PAS':
      return 'Je ne sais pas.';
    default: {
      const spoken = speakableText(label, lexicon);
      return spoken === '' ? '' : `${sentenceCase(spoken)}.`;
    }
  }
}
