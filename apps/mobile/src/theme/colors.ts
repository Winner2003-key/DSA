/**
 * DSA palette — a cool paper white with a muted teal-blue for actions, and a
 * slate night theme that mirrors it. Nothing saturated outside the answers.
 *
 * `brass` is kept as the token name for the action colour (what you press), so
 * components did not have to change when the palette moved away from brass;
 * `accent` is the warm second colour for a selected role. Answers are the book's own page-2 tag
 * colours (what was said): OUI green, NON amber, the repeated codes red, JE NE
 * SAIS PAS blue. Colour is never the only signal — every answer carries its word,
 * and the repeated codes also carry the stacked-bar mark.
 */

export interface AnswerColor {
  readonly fill: string;
  readonly ink: string;
  /** The solid "underside" of the slab: what makes the button feel physical. */
  readonly edge: string;
}

export interface Palette {
  readonly scheme: 'light' | 'dark';
  readonly bg: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly line: string;
  readonly ink: string;
  readonly inkSoft: string;
  readonly inkFaint: string;
  readonly brass: string;
  readonly brassInk: string;
  readonly brassEdge: string;
  /** Warm second accent: the Découvreur's selection, soft highlights. */
  readonly accent: string;
  readonly accentSoft: string;
  /** Tinted background behind a selected card or an icon tile. */
  readonly brassSoft: string;
  readonly danger: string;
  readonly overlay: string;
  readonly answers: {
    readonly OUI: AnswerColor;
    readonly NON: AnswerColor;
    readonly OUI_REPETE: AnswerColor;
    readonly NON_REPETE: AnswerColor;
    readonly JE_NE_SAIS_PAS: AnswerColor;
    readonly AUTRE: AnswerColor;
  };
}

export const darkPalette: Palette = {
  scheme: 'dark',
  bg: '#12181C',
  surface: '#1A2227',
  surfaceRaised: '#222C32',
  line: '#2E3A41',
  ink: '#E8EEF0',
  inkSoft: '#A3B2B8',
  inkFaint: '#6E7F86',
  brass: '#6FB3C4',
  brassInk: '#0E1B20',
  brassEdge: '#4A8A9A',
  accent: '#D9A45B',
  accentSoft: '#2E2A22',
  brassSoft: '#1D3037',
  danger: '#E07A66',
  overlay: 'rgba(8, 12, 14, 0.86)',
  answers: {
    OUI: { fill: '#3C8A5E', ink: '#F2FBF5', edge: '#285F40' },
    NON: { fill: '#D9A441', ink: '#221905', edge: '#9E7422' },
    OUI_REPETE: { fill: '#B5503F', ink: '#FFF2EE', edge: '#7C3226' },
    NON_REPETE: { fill: '#B5503F', ink: '#FFF2EE', edge: '#7C3226' },
    JE_NE_SAIS_PAS: { fill: '#4677B0', ink: '#F1F6FD', edge: '#2E5382' },
    AUTRE: { fill: '#3A474E', ink: '#DCE4E7', edge: '#252F34' },
  },
};

export const lightPalette: Palette = {
  scheme: 'light',
  bg: '#EEF2F4',
  surface: '#F7F9FA',
  surfaceRaised: '#FFFFFF',
  line: '#D5DEE2',
  ink: '#17252B',
  inkSoft: '#51636B',
  inkFaint: '#85959C',
  brass: '#2F6B7A',
  brassInk: '#FFFFFF',
  brassEdge: '#22505C',
  accent: '#C07F2C',
  accentSoft: '#FBF1E3',
  brassSoft: '#E4EFF2',
  danger: '#B04A36',
  overlay: 'rgba(23, 37, 43, 0.72)',
  answers: {
    OUI: { fill: '#3A8159', ink: '#F2FBF5', edge: '#285C3F' },
    NON: { fill: '#D9A441', ink: '#221905', edge: '#A07624' },
    OUI_REPETE: { fill: '#B0493A', ink: '#FFF2EE', edge: '#7A3024' },
    NON_REPETE: { fill: '#B0493A', ink: '#FFF2EE', edge: '#7A3024' },
    JE_NE_SAIS_PAS: { fill: '#3E6FA8', ink: '#F1F6FD', edge: '#2A4E7A' },
    AUTRE: { fill: '#6C7C83', ink: '#F4F7F8', edge: '#4B585E' },
  },
};
