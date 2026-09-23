export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

/**
 * Radii differ by role rather than being one value everywhere: the prompt card
 * is a soft card, the answer slabs are cut like keys, chips are pills, and the
 * path trail is ruled, not boxed.
 */
export const radius = {
  chip: 999,
  slab: 12,
  card: 16,
  secret: 16,
  field: 10,
} as const;

/** The reading column. Wider than this and long labels stop scanning well. */
export const maxContentWidth = 520;

/** Every touch target clears the 56 pt floor (S3b brief); answers are bigger still. */
export const touch = {
  answer: 72,
  primary: 64,
  secondary: 56,
  icon: 56,
} as const;
