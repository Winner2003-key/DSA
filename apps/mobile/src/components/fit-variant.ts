import type { TextVariant } from './app-text';

/**
 * Picks the largest size at which the longest word still fits the phone column.
 * `adjustsFontSizeToFit` does nothing on the web, and a book label like
 * PENTATEUQUE must never break mid-word, so size is chosen from the text itself.
 */
export function fitVariant(text: string, largest: 'hero' | 'display' = 'hero'): TextVariant {
  const longestWord = Math.max(0, ...text.split(/\s+/).map((word) => word.length));
  if (largest === 'hero' && longestWord <= 8 && text.length <= 22) return 'hero';
  if (longestWord <= 12) return 'display';
  return 'title';
}
