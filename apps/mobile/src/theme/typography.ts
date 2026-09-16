import { Platform } from 'react-native';

/**
 * One family throughout: Zilla Slab. A sturdy low-contrast slab reads at arm's
 * length across a table, which is how this game is actually played, and it keeps
 * the printed-booklet character of the source booklet without the luxury-magazine
 * high-contrast serif look.
 */
export const fontFamilies = {
  regular: 'ZillaSlab_400Regular',
  medium: 'ZillaSlab_500Medium',
  semibold: 'ZillaSlab_600SemiBold',
  bold: 'ZillaSlab_700Bold',
} as const;

/** Used until the webfont is loaded, and if loading fails. */
export const fallbackFamily = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, "Times New Roman", serif',
}) as string;

export const fontSize = {
  micro: 13,
  small: 15,
  body: 17,
  lead: 20,
  title: 26,
  display: 34,
  hero: 46,
  colossal: 60,
} as const;

export const lineHeight = {
  micro: 18,
  small: 21,
  body: 25,
  lead: 28,
  title: 32,
  display: 40,
  hero: 52,
  colossal: 64,
} as const;
