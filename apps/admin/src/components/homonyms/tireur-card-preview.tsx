'use client';

import { Zilla_Slab } from 'next/font/google';

/**
 * The Tireur's card, face up, as `apps/mobile/src/components/secret-card.tsx`
 * draws it: "Ta carte", the NAME large and bold, the description small and soft
 * below it, "Cacher" in the corner. Same font (Zilla Slab), palette, sizes,
 * radii and paddings, at the width of the card on a 390 pt phone.
 *
 * On this page every name is shared, so the description is always shown — that
 * is exactly when the app shows it (GRAPH_SPECIFICATION §8).
 */
const zilla = Zilla_Slab({ subsets: ['latin', 'latin-ext'], weight: ['400', '700'], display: 'swap' });

/** `apps/mobile/src/theme/colors.ts`. The app follows the system theme and defaults to dark. */
const PALETTES = {
  dark: { surfaceRaised: '#1E2F28', line: '#2B3C34', ink: '#F3EEE2', inkSoft: '#9FB0A4', inkFaint: '#6B7C71', brass: '#E9A825', bg: '#0E1A17' },
  light: { surfaceRaised: '#FFFFFF', line: '#C6D2C4', ink: '#13251D', inkSoft: '#4F6459', inkFaint: '#7B8E82', brass: '#B8760A', bg: '#E7EDE6' },
} as const;

export type CardScheme = keyof typeof PALETTES;

/** `apps/mobile/src/components/fit-variant.ts` with `typography.ts` sizes: [fontSize, lineHeight, letterSpacing]. */
export function nameSize(name: string): [number, number, number] {
  const longestWord = Math.max(0, ...name.split(/\s+/).map((word) => word.length));
  if (longestWord <= 8 && name.length <= 22) return [46, 52, -1.2];
  if (longestWord <= 12) return [34, 40, -0.4];
  return [26, 32, -0.4];
}

/** Width of the card on a 390 pt phone: the screen minus the 20 pt side padding. */
export const CARD_WIDTH = 350;

export function TireurCardPreview({ name, description, scheme = 'dark' }: { name: string; description: string | null; scheme?: CardScheme }) {
  const c = PALETTES[scheme];
  const [fontSize, lineHeight, letterSpacing] = nameSize(name);
  const shown = description && description.trim() !== '' ? description : null;

  return (
    <div className={zilla.className} style={{ background: c.bg, padding: 12, borderRadius: 8, alignSelf: 'flex-start', maxWidth: '100%' }} aria-label={`Aperçu de la carte du Tireur : ${name}`}>
      <div
        style={{
          width: CARD_WIDTH,
          maxWidth: '100%',
          minHeight: 188,
          borderRadius: 20,
          padding: 7,
          backgroundColor: c.surfaceRaised,
          borderBottom: `5px solid ${c.line}`,
          display: 'flex',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 170,
            borderRadius: 14,
            border: `1.5px solid ${c.brass}`,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 15, lineHeight: '21px', color: c.inkSoft }}>Ta carte</div>
          <div style={{ fontSize, lineHeight: `${lineHeight}px`, letterSpacing, fontWeight: 700, color: c.ink, overflowWrap: 'anywhere' }}>{name}</div>
          {shown ? <div style={{ fontSize: 17, lineHeight: '25px', color: c.inkSoft }}>{shown}</div> : <div />}
          <div style={{ fontSize: 13, lineHeight: '18px', color: c.inkFaint, alignSelf: 'flex-end' }}>Cacher</div>
        </div>
      </div>
    </div>
  );
}
