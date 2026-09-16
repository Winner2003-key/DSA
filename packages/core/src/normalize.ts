// French text normalization shared by keys, answers, rules and intents.

const APOSTROPHES = /[’‘ʼ´`']/g;

/** Strips diacritics and expands ligatures (œ→oe, æ→ae). Case is preserved. */
export function stripAccents(s: string): string {
  return s
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Lowercase, accents stripped, apostrophes unified to `'`, every other
 * punctuation mark turned into a space, whitespace collapsed.
 */
export function normalizeText(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(APOSTROPHES, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/'+/g, "'")
    .replace(/\s*'\s*/g, "'")
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name comparison form: like normalizeText, and also ignores hyphens, spaces and apostrophes. */
export function normalizeName(s: string): string {
  return normalizeText(s).replace(/[\s']/g, '');
}

/** Words of a normalized utterance; apostrophes split words ("c'est" → c, est). */
export function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n === '' ? [] : n.split(/[\s']+/).filter((t) => t !== '');
}
