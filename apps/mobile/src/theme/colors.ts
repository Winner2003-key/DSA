/**
 * DSA palette — "le tableau": a chalkboard recitation lit by a brass lamp.
 *
 * The game is played aloud, often in the evening, with one phone passed across a
 * table, so the dark theme is the reference and the light theme is its daytime
 * exercise-book counterpart.
 *
 * Brass is for actions (what you press). Answers are the book's own page-2 tag
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
  bg: '#0E1A17',
  surface: '#16241F',
  surfaceRaised: '#1E2F28',
  line: '#2B3C34',
  ink: '#F3EEE2',
  inkSoft: '#9FB0A4',
  inkFaint: '#6B7C71',
  brass: '#E9A825',
  brassInk: '#14210F',
  brassEdge: '#A8740E',
  danger: '#E2705A',
  overlay: 'rgba(6, 12, 10, 0.86)',
  answers: {
    OUI: { fill: '#2E8049', ink: '#F2FBF4', edge: '#1B5530' },
    NON: { fill: '#E3B23C', ink: '#231A05', edge: '#A57C18' },
    OUI_REPETE: { fill: '#B8412F', ink: '#FFF2EE', edge: '#7C2619' },
    NON_REPETE: { fill: '#B8412F', ink: '#FFF2EE', edge: '#7C2619' },
    JE_NE_SAIS_PAS: { fill: '#2F6DB5', ink: '#F1F6FD', edge: '#1D4A80' },
    AUTRE: { fill: '#3A4A42', ink: '#DCE3DC', edge: '#232F29' },
  },
};

export const lightPalette: Palette = {
  scheme: 'light',
  bg: '#E7EDE6',
  surface: '#F5F8F3',
  surfaceRaised: '#FFFFFF',
  line: '#C6D2C4',
  ink: '#13251D',
  inkSoft: '#4F6459',
  inkFaint: '#7B8E82',
  brass: '#B8760A',
  brassInk: '#FFF7E8',
  brassEdge: '#7E4F04',
  danger: '#A63A22',
  overlay: 'rgba(19, 37, 29, 0.76)',
  answers: {
    OUI: { fill: '#277342', ink: '#F2FBF4', edge: '#174A29' },
    NON: { fill: '#E0A92A', ink: '#231A05', edge: '#9C7212' },
    OUI_REPETE: { fill: '#A93A29', ink: '#FFF2EE', edge: '#6E2115' },
    NON_REPETE: { fill: '#A93A29', ink: '#FFF2EE', edge: '#6E2115' },
    JE_NE_SAIS_PAS: { fill: '#2A62A6', ink: '#F1F6FD', edge: '#1A4175' },
    AUTRE: { fill: '#65756B', ink: '#F4F7F2', edge: '#44514A' },
  },
};
