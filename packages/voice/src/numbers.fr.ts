// French numbers for speech: "TOME 1" → "tome un", "1ère classe" → "première classe".

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante', 8: 'quatre-vingt' };

function below100(n: number): string {
  if (n <= 16) return UNITS[n] as string;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  if (ten === 7) return n === 71 ? 'soixante et onze' : `soixante-${below100(10 + unit)}`;
  if (ten === 9) return `quatre-vingt-${below100(10 + unit)}`;
  if (ten === 8) return unit === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITS[unit]}`;
  if (unit === 0) return TENS[ten] as string;
  if (unit === 1) return `${TENS[ten]} et un`;
  return `${TENS[ten]}-${UNITS[unit]}`;
}

/** Cardinal in words (0–9999); larger numbers stay as digits. */
export function cardinalFr(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n < 100) return below100(n);
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const head = hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent${rest === 0 ? 's' : ''}`;
    return rest === 0 ? head : `${head} ${below100(rest)}`;
  }
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mille' : `${UNITS[thousands]} mille`;
  return rest === 0 ? head : `${head} ${cardinalFr(rest)}`;
}

/** Ordinal in words: 1 → premier/première, 2 → deuxième, 5 → cinquième, 21 → vingt et unième. */
export function ordinalFr(n: number, feminine = false): string {
  if (n === 1) return feminine ? 'première' : 'premier';
  const words = cardinalFr(n);
  if (/\d/.test(words)) return `${words}e`;
  if (words.endsWith('cinq')) return `${words}uième`;
  if (words.endsWith('neuf')) return `${words.slice(0, -1)}vième`;
  if (words.endsWith('e')) return `${words.slice(0, -1)}ième`;
  if (words.endsWith('quatre-vingts') || words.endsWith('cents')) return `${words.slice(0, -1)}ième`;
  return `${words}ième`;
}

/**
 * Reads an ordinal token ("1er", "1ère", "1ERE", "2eme", "3ème", "2nd", "4e").
 * Returns null when the token isn't one.
 */
export function readOrdinalToken(token: string): string | null {
  const m = /^(\d+)\s*(er|re|ère|ere|ieme|ième|eme|ème|e|è|nd|nde)(s?)$/i.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  const suffix = (m[2] as string).toLowerCase();
  const feminine = suffix === 're' || suffix === 'ère' || suffix === 'ere' || suffix === 'nde';
  if ((suffix === 'nd' || suffix === 'nde') && n === 2) return feminine ? 'seconde' : 'second';
  return ordinalFr(n, feminine) + (m[3] ? 's' : '');
}
