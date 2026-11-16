// Closed-set matching for the five things a Tireur may say.
//
// The Tireur's vocabulary is closed: OUI, NON, their held forms, JE NE SAIS PAS,
// and QUESTION — nothing else (GAME_RULES §1 and §4). That makes his turn a
// 4-way classification, not a transcription, and it is the one place where being
// generous pays: with four candidates there is almost nothing a mangled "oui"
// could be mistaken for.
//
// Why this exists next to `matchIntent`: the core matcher is exact on purpose
// (it also serves typed input and the rules engine), so `OUI_PHRASES.has(…)`
// answers no to everything Whisper actually writes for a 400 ms "oui" — "Hui",
// "Wi", "Ouh", "Houi" — and for "question": "Gestion", "Kestion". Whisper is a
// free-form transcriber that cannot be given a grammar, so the only place to
// close the set is here, after it has spoken. This module is the tolerant
// layer; core stays strict.
//
// Measured with `npm run voice:eval -- --answers` before any threshold below is
// touched. False accepts are far worse than misses: a wrong OUI sends the game
// down the wrong branch, while a miss only costs « Peux-tu répéter ? ».

import { jaroWinkler, normalizeName, tokenize } from '@dsa/core';

/** What the Tireur meant. REWIND is "question", which undoes instead of answering. */
export type ClosedSetValue = 'OUI' | 'NON' | 'JE_NE_SAIS_PAS' | 'REWIND';

export const ANSWER_MATCH = {
  /** The whole utterance must reach this to be read as one of the four. */
  score: 0.78,
  /** One word inside a longer utterance must reach this (stricter: less context to go on). */
  token: 0.86,
  /** Two different answers closer than this are not told apart: nothing is returned. */
  margin: 0.06,
  /** An utterance with more than this many other words is not an answer with filler. */
  maxExtraTokens: 3,
  /** An empty key carries nothing to compare. */
  minKeyLength: 1,
  /** What a one-syllable match must reach once its onset agrees. */
  shortScore: 0.84,
  /**
   * What a match against an alias of several words must reach. "Je ne sais pas"
   * and "pas du tout" are long enough that a recogniser gets them right or not
   * at all, so there is nothing to gain by being generous — and plenty to lose:
   * at the general threshold, "Absalom" scores 0.80 against "absolument pas"
   * and "revenir à Ancien" scores 0.81 against "je n'en sais rien".
   */
  phraseScore: 0.9,
} as const;

/**
 * Phonetic key for this vocabulary only — not `phoneticKey`, which is tuned for
 * 1087 book names and maps w→v (turning Whisper's "Wi" away from "oui" instead
 * of towards it).
 *
 * What it folds, each from something a French recogniser really writes:
 *   stray aspirate   "Hui", "Ouh"      → h dropped at both ends
 *   qu/c/ph          "Gestion", "Kestion" → one k sound
 *   w as /w/         "Wi"              → "ou"
 *   held vowels      "Ouiii", "Nonnn"  → doubles collapsed
 *   the /wi/ onset   "oui" = "hui"     → leading "ou" becomes "u"
 */
export function answerKey(word: string): string {
  let key = normalizeName(word);
  if (key === '') return '';
  key = key.replace(/^h+/, '').replace(/h+$/, '');
  key = key.replace(/qu/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/ck|q/g, 'k').replace(/ph/g, 'f');
  key = key.replace(/w/g, 'ou');
  key = key.replace(/(.)\1+/g, '$1');
  key = key.replace(/^ou/, 'u');
  // A final mute e, which is only mute after a consonant: "exacte" → "exact",
  // while "Noé" keeps its second syllable (dropping it made "Noé" a NON).
  if (key.length > 2) key = key.replace(/(?<=[bcdfgjklmnprstvxz])e$/, '');
  return key;
}

const VOWELS = /[aeiouy]+/g;

/**
 * How many syllables a key carries, counted as runs of vowels. One means the
 * word is a monosyllable, which is where a recogniser's errors land and where
 * Jaro-Winkler stops being able to tell a vowel change from a consonant one.
 */
export function syllables(key: string): number {
  return (key.match(VOWELS) ?? []).length;
}

/**
 * Similarity of two spoken forms, 0…1. Exact spelling always beats a phonetic
 * match, and 0 means "not the same word" rather than "a bit different".
 *
 * The one-syllable rule is the reason this is not just `jaroWinkler`. Every
 * word in this vocabulary but one is a monosyllable, and on three letters
 * Jaro-Winkler cannot separate a vowel change from a consonant change: "bon"
 * and "nan" both score 0.778 against "non", though only one of them is a player
 * saying no. So when either side is a monosyllable the onset must agree — the
 * initial consonant is the part a recogniser gets right — and the score must
 * clear a higher bar. That one rule is what keeps "nous", "Louis" and "ouest"
 * away from "ouais", which attracted all three on score alone.
 */
export function answerSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;
  const ka = answerKey(a);
  const kb = answerKey(b);
  if (ka.length < ANSWER_MATCH.minKeyLength || kb.length < ANSWER_MATCH.minKeyLength) return 0;
  if (ka === kb) return 0.98;
  // A phonetic-only match stays just below an exact spelling, as in `scoreName`.
  const score = Math.max(jaroWinkler(na, nb), Math.min(0.97, jaroWinkler(ka, kb)));
  if (Math.min(syllables(ka), syllables(kb)) <= 1) {
    if (ka[0] !== kb[0]) return 0;
    if (score < ANSWER_MATCH.shortScore) return 0;
  }
  return score;
}

interface Candidate {
  value: ClosedSetValue;
  /** Spoken forms, single-word ones first. Order does not affect the score. */
  aliases: readonly string[];
}

/**
 * Every way a player says one of the four, as a starting point — the fuzzy pass
 * catches the rest. Deliberately does NOT contain anything a Découvreur says:
 * only the Tireur's turn reaches this matcher, and a name must never become an
 * answer.
 */
export const ANSWER_CANDIDATES: readonly Candidate[] = Object.freeze([
  Object.freeze({
    value: 'OUI' as const,
    aliases: Object.freeze(["oui", "ouais", "ouai", "exact", "exactement", "affirmatif", "c'est ca", "tout a fait", "c'est exact"]),
  }),
  Object.freeze({
    value: 'NON' as const,
    aliases: Object.freeze(["non", "nan", "negatif", "pas du tout", "absolument pas", "certainement pas"]),
  }),
  Object.freeze({
    value: 'JE_NE_SAIS_PAS' as const,
    aliases: Object.freeze([
      "je ne sais pas",
      "je sais pas",
      "j sais pas",
      "chais pas",
      "sais pas",
      "aucune idee",
      "je n'en sais rien",
      "j'en sais rien",
    ]),
  }),
  Object.freeze({ value: 'REWIND' as const, aliases: Object.freeze(["question", "questions"]) }),
]);

export interface ClosedSetMatch {
  value: ClosedSetValue;
  score: number;
  /** The alias it matched, for the diagnostic line. */
  alias: string;
  /** The utterance was exactly this alias: no fuzziness was needed. */
  exact: boolean;
  /** How many tokens matched (a "question question" rewind counts 2). */
  count: number;
}

export interface ClosedSetOptions {
  score?: number;
  token?: number;
  margin?: number;
  candidates?: readonly Candidate[];
}

/** Best score of `tokens` against one alias, and how many tokens it consumed. */
function aliasScore(tokens: readonly string[], alias: string, opts: Required<Pick<ClosedSetOptions, 'token'>>): { score: number; count: number } {
  const aliasTokens = tokenize(alias);
  if (aliasTokens.length === 0 || tokens.length === 0) return { score: 0, count: 0 };
  // Several words: near-exact or nothing (ANSWER_MATCH.phraseScore).
  const floor = aliasTokens.length > 1 ? ANSWER_MATCH.phraseScore : 0;

  // The whole utterance against the whole alias, run together: this is what
  // catches "ouioui" against "oui" and "chaispas" against "je sais pas".
  const whole = answerSimilarity(tokens.join(''), aliasTokens.join(''));
  let best = whole >= floor ? whole : 0;
  let count = best > 0 ? tokens.length : 0;

  // Any window of the utterance the length of the alias: "ah oui bien sur".
  const span = aliasTokens.length;
  if (tokens.length > span) {
    const extra = tokens.length - span;
    if (extra <= ANSWER_MATCH.maxExtraTokens) {
      for (let i = 0; i + span <= tokens.length; i++) {
        const window = tokens.slice(i, i + span).join('');
        const score = answerSimilarity(window, aliasTokens.join(''));
        // A word pulled out of a longer utterance has to clear the higher bar.
        if (score >= Math.max(opts.token, floor) && score > best) {
          best = score;
          count = span;
        }
      }
    }
  }

  // Repetitions of a single-word alias: "oui oui", "question question".
  if (span === 1) {
    const matching = tokens.filter((t) => answerSimilarity(t, aliasTokens[0] as string) >= opts.token);
    if (matching.length >= 2 && matching.length === tokens.length) {
      const scores = matching.map((t) => answerSimilarity(t, aliasTokens[0] as string));
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      // >= and not >: every token matching the alias equally well is the same
      // word repeated, which is exactly the case that has to be counted
      // ("question question" rewinds two steps, not one).
      if (mean >= best) {
        best = Math.max(best, mean);
        count = matching.length;
      }
    }
  }

  return { score: best, count: Math.max(1, count) };
}

/**
 * The best of the four, or null when nothing is close enough or two are too
 * close to tell apart. Never guesses: null means "ask again", which is always
 * the safe answer.
 */
export function matchClosedSet(utterance: string, options: ClosedSetOptions = {}): ClosedSetMatch | null {
  const score = options.score ?? ANSWER_MATCH.score;
  const token = options.token ?? ANSWER_MATCH.token;
  const margin = options.margin ?? ANSWER_MATCH.margin;
  const candidates = options.candidates ?? ANSWER_CANDIDATES;

  const tokens = tokenize(utterance);
  if (tokens.length === 0) return null;

  const ranked: ClosedSetMatch[] = [];
  for (const candidate of candidates) {
    let best: ClosedSetMatch | null = null;
    for (const alias of candidate.aliases) {
      const { score: s, count } = aliasScore(tokens, alias, { token });
      if (s <= 0 || (best && s <= best.score)) continue;
      best = { value: candidate.value, score: s, alias, exact: s === 1, count };
    }
    if (best && best.score >= score) ranked.push(best);
  }
  ranked.sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top) return null;
  const second = ranked.find((r) => r.value !== top.value);
  if (second && top.score - second.score < margin) return null;
  return top;
}
