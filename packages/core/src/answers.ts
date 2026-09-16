import type { AnswerClass, Prompt } from './types';
import { stripAccents } from './normalize';

function lettersOnly(label: string): string {
  return stripAccents(label.toUpperCase()).replace(/[^A-Z]/g, '');
}

function countOverlapping(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) count++;
  return count;
}

/**
 * Classifies an answer label. The repetition count is never significant:
 * OUI said ≥2 times is OUI_REPETE, NON said ≥2 times (overlaps allowed, so
 * "NONONO" counts) is NON_REPETE.
 */
export function answerClass(label: string): AnswerClass {
  const s = lettersOnly(label);
  if (s === 'JENESAISPAS') return 'JE_NE_SAIS_PAS';
  if (s === 'OUI') return 'OUI';
  if (s === 'NON') return 'NON';
  if (/^(OUI){2,}$/.test(s)) return 'OUI_REPETE';
  if (/^[NO]+$/.test(s) && s.startsWith('NO') && countOverlapping(s, 'NON') >= 2) return 'NON_REPETE';
  return 'AUTRE';
}

/** The answer classes a prompt accepts. */
export function allowedClassesFor(prompt: Prompt): AnswerClass[] {
  return prompt.kind === 'CHILD' ? ['OUI', 'NON'] : [...prompt.answerClasses];
}

/** Two AUTRE labels are the same answer only if their letters match. */
export function sameAnswer(a: string, b: string): boolean {
  const ca = answerClass(a);
  if (ca !== answerClass(b)) return false;
  return ca !== 'AUTRE' || lettersOnly(a) === lettersOnly(b);
}
