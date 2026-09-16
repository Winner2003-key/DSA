// Deterministic French intent matcher for voice or typed input. No LLM.

import { answerClass } from './answers';
import { normalizeName, tokenize } from './normalize';
import type { AnswerClass, Intent, IntentContext } from './types';

export const INTENT_THRESHOLDS = {
  /** Minimum prompt similarity for ASK. */
  ask: 0.75,
  /** Minimum name similarity for GUESS. */
  guess: 0.88,
  /** Minimum path-text similarity to pick a BACK target. */
  back: 0.7,
  /** Minimum Jaro-Winkler score for two words to count as the same word. */
  token: 0.85,
  /** ASK wins over a plausible GUESS only if its score is at least this much higher. */
  askOverGuess: 0.08,
  /** Two different names closer than this are ambiguous → UNKNOWN. */
  guessAmbiguity: 0.03,
  /** Names this short must be the whole (scaffolding-stripped) utterance. */
  shortNameLength: 3,
} as const;

// ---------------------------------------------------------------------------
// String similarity

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Rough French phonetic key so that "Kaïn"/"Caïn" or "Tsophar"/"Tsofar" compare equal. */
export function phoneticKey(word: string): string {
  return normalizeName(word)
    .replace(/sch/g, 'ch')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/qu/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c(?!h)/g, 'k')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/(?<![cs])h/g, '')
    .replace(/(.)\1+/g, '$1');
}

function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  return Math.max(jaroWinkler(a, b), jaroWinkler(phoneticKey(a), phoneticKey(b)));
}

// ---------------------------------------------------------------------------
// Utterance canonicalization

// "ben" is deliberately absent: it starts names (BEN-AMMI, BEN-ONI).
const FILLERS = new Set(['euh', 'heu', 'hum', 'hmm', 'bon', 'bah', 'alors', 'attends', 'attend', 'voyons', 'donc', 'ok', 'okay', 'hein']);

const SCAFFOLDING = new Set([
  'est', 'ce', 'que', 'qu', 'c', 'il', 'elle', 's', 'agit', 't', 'dans', 'le', 'la', 'les', 'l', 'du', 'de', 'des', 'd', 'un', 'une', 'en', 'au', 'aux',
  'je', 'pense', 'crois', 'serait', 'ca', 'cela', 'ceci', 'quoi', 'peut', 'etre', 'alors',
]);

const WORD_ORDINALS: Record<string, string> = {
  premier: '1', premiere: '1', premiers: '1', premieres: '1',
  deuxieme: '2', second: '2', seconde: '2', deuxiemes: '2',
  troisieme: '3', quatrieme: '4', cinquieme: '5', sixieme: '6', septieme: '7', huitieme: '8', neuvieme: '9', dixieme: '10',
};
const CARDINALS: Record<string, string> = {
  deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9', dix: '10', douze: '12',
};
const COUNTED_NOUNS = new Set(['tome', 'classe', 'groupe', 'periode', 'generation']);

/** Maps ordinals and cardinals to digits ("1ère", "premier" → "1"; "tome un" → "tome 1"). */
function canonicalWords(tokens: string[]): string[] {
  return tokens.map((t, i) => {
    const ordinal = /^(\d+)(er|re|ere|e|eme|ieme|nd|nde|emes|ers|eres)$/.exec(t);
    if (ordinal) return ordinal[1] as string;
    const word = WORD_ORDINALS[t] ?? CARDINALS[t];
    if (word) return word;
    if ((t === 'un' || t === 'une') && i > 0 && COUNTED_NOUNS.has(tokens[i - 1] as string)) return '1';
    return t;
  });
}

function contentTokens(text: string): string[] {
  const tokens = canonicalWords(tokenize(text).filter((t) => !FILLERS.has(t)));
  const content = tokens.filter((t) => !SCAFFOLDING.has(t));
  return content.length > 0 ? content : tokens.filter((t) => t !== 'est' && t !== 'ce' && t !== 'que' && t !== 'c');
}

/** Similarity between an utterance and a prompt/path text (fuzzy token overlap, Dice-style). */
export function textSimilarity(utterance: string, text: string): number {
  const u = contentTokens(utterance);
  const p = contentTokens(text);
  if (u.length === 0 || p.length === 0) return 0;
  const digits = (ts: string[]) => ts.filter((t) => /^\d+$/.test(t)).sort().join(',');
  const used = new Array<boolean>(u.length).fill(false);
  let matched = 0;
  for (const pt of p) {
    let best = -1;
    let bestScore = 0;
    u.forEach((ut, i) => {
      if (used[i]) return;
      const score = wordSimilarity(ut, pt);
      if (score >= INTENT_THRESHOLDS.token && score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) {
      used[best] = true;
      matched += bestScore;
    }
  }
  let score = (2 * matched) / (u.length + p.length);
  // Same words, different number ("classe 1" vs "classe 2"): never a match.
  if (digits(u) !== digits(p)) score = Math.min(score, 0.4);
  return score;
}

// ---------------------------------------------------------------------------
// ANSWER / REWIND

const OUI_PHRASES = new Set(['oui', 'ouais', 'ouai', 'exact', 'exactement', 'c est ca', 'tout a fait', 'oui c est ca', 'oui tout a fait', 'c est exact', 'oui exact']);
const NON_PHRASES = new Set(['non', 'nan', 'pas du tout', 'non pas du tout', 'absolument pas']);
const JNSP_PHRASES = new Set(['je ne sais pas', 'je sais pas', 'chais pas', 'j sais pas', 'sais pas', 'je n en sais rien', 'aucune idee']);

function answerClassOfUtterance(tokens: string[]): AnswerClass | null {
  if (tokens.length === 0) return null;
  const phrase = tokens.join(' ');
  if (JNSP_PHRASES.has(phrase)) return 'JE_NE_SAIS_PAS';
  if (OUI_PHRASES.has(phrase)) return 'OUI';
  if (NON_PHRASES.has(phrase)) return 'NON';
  const compact = tokens.join('');
  if (!/^[a-z]+$/.test(compact)) return null;
  const cls = answerClass(compact);
  return cls === 'OUI_REPETE' || cls === 'NON_REPETE' ? cls : null;
}

function matchRewind(tokens: string[]): 1 | 2 | 3 | null {
  if (tokens.length === 0 || !tokens.every((t) => t === 'question' || t === 'questions')) return null;
  return tokens.length <= 3 ? (tokens.length as 1 | 2 | 3) : null;
}

// ---------------------------------------------------------------------------
// BACK

const BACK_WORDS = new Set(['retour', 'revenir', 'reviens', 'revenons', 'revient', 'retourner', 'retourne']);
const BACK_LEADING = new Set(['on', 'je', 'veux', 'voudrais', 'faut', 'il', 'peut', 'est', 'ce', 'que', 'qu', 'on', 'va', 'veut', 'retour', 'revenir', 'reviens', 'revenons', 'revient', 'retourner', 'retourne', 'en', 'arriere', 'a', 'au', 'aux', 'la', 'le', 'les', 'l', 'sur', 'question']);

function matchBack(tokens: string[], ctx: IntentContext): Intent | null {
  const hasBackWord = tokens.some((t) => BACK_WORDS.has(t));
  const precedente = tokens.includes('precedente') || tokens.includes('precedent');
  if (!hasBackWord && !precedente) return null;
  const lastIndex = ctx.path.length > 0 ? (ctx.path[ctx.path.length - 1] as { index: number }).index : undefined;
  if (precedente && tokens.every((t) => t === 'question' || t === 'precedente' || t === 'precedent' || BACK_LEADING.has(t))) {
    return lastIndex === undefined ? { type: 'BACK' } : { type: 'BACK', stepIndex: lastIndex };
  }
  let start = 0;
  while (start < tokens.length && BACK_LEADING.has(tokens[start] as string)) start++;
  const rest = tokens.slice(start).join(' ');
  if (rest === '') return { type: 'BACK' };
  let best: { index: number; score: number } | null = null;
  for (const p of ctx.path) {
    const score = textSimilarity(rest, p.text);
    if (score >= INTENT_THRESHOLDS.back && (!best || score >= best.score)) best = { index: p.index, score };
  }
  return best ? { type: 'BACK', stepIndex: best.index } : { type: 'BACK' };
}

// ---------------------------------------------------------------------------
// GUESS

interface NameScore {
  name: string;
  key: string;
  score: number;
}

function scoreName(tokens: string[], name: string): number {
  const target = normalizeName(name);
  if (target === '' || tokens.length === 0) return 0;
  let best = 0;
  for (let len = 1; len <= Math.min(4, tokens.length); len++) {
    for (let i = 0; i + len <= tokens.length; i++) {
      const gram = tokens.slice(i, i + len).join('');
      if (target.length <= INTENT_THRESHOLDS.shortNameLength && len !== tokens.length) continue;
      const ratio = Math.min(gram.length, target.length) / Math.max(gram.length, target.length);
      if (ratio < 0.6) continue;
      // A phonetic-only match stays below an exact one (ABRAM must beat ABRAHAM for "Abram").
      const sim = gram === target ? 1 : Math.max(jaroWinkler(gram, target), Math.min(0.95, jaroWinkler(phoneticKey(gram), phoneticKey(target))));
      const coverage = len / tokens.length;
      best = Math.max(best, sim * (0.85 + 0.15 * coverage));
    }
  }
  return best;
}

function matchGuess(utterance: string, knownNames: string[]): { name: string; score: number } | 'AMBIGUOUS' | null {
  const tokens = tokenize(utterance).filter((t) => !FILLERS.has(t) && !SCAFFOLDING.has(t));
  if (tokens.length === 0) return null;
  const byKey = new Map<string, NameScore>();
  for (const name of knownNames) {
    const key = normalizeName(name);
    if (key === '' || byKey.has(key)) continue;
    byKey.set(key, { name, key, score: scoreName(tokens, name) });
  }
  const ranked = [...byKey.values()].filter((s) => s.score >= INTENT_THRESHOLDS.guess).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  const second = ranked[1];
  if (second && top.score - second.score < INTENT_THRESHOLDS.guessAmbiguity) return 'AMBIGUOUS';
  return { name: top.name, score: top.score };
}

// ---------------------------------------------------------------------------

export function matchIntent(utterance: string, ctx: IntentContext): Intent {
  const tokens = tokenize(utterance).filter((t) => !FILLERS.has(t));
  if (tokens.length === 0) return { type: 'UNKNOWN' };

  if (ctx.role === 'TIREUR') {
    const rewind = matchRewind(tokens);
    if (rewind !== null) return { type: 'REWIND', count: rewind };
    const cls = answerClassOfUtterance(tokens);
    if (cls !== null) {
      const label = ctx.answerLabels.find((l) => answerClass(l) === cls);
      if (label !== undefined) return { type: 'ANSWER', label };
    }
    return { type: 'UNKNOWN' };
  }

  const back = matchBack(tokens, ctx);
  if (back) return back;

  const askScore = ctx.prompt ? textSimilarity(utterance, ctx.prompt.text) : 0;
  const guess = matchGuess(utterance, ctx.knownNames);
  const askOk = askScore >= INTENT_THRESHOLDS.ask;
  const round = (n: number) => Math.round(n * 1000) / 1000;

  if (guess === 'AMBIGUOUS') return askOk ? { type: 'ASK', confidence: round(askScore) } : { type: 'UNKNOWN' };
  if (guess && askOk) {
    return askScore >= guess.score + INTENT_THRESHOLDS.askOverGuess
      ? { type: 'ASK', confidence: round(askScore) }
      : { type: 'GUESS', name: guess.name, confidence: round(guess.score) };
  }
  if (askOk) return { type: 'ASK', confidence: round(askScore) };
  if (guess) return { type: 'GUESS', name: guess.name, confidence: round(guess.score) };
  return { type: 'UNKNOWN' };
}
