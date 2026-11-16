// The Tireur's side of `npm run voice:eval`: what the closed-set matcher does
// with what a French recogniser really writes for the only five things he may
// say (`packages/voice/src/answer-match.ts`).
//
// Two tables, and the second one matters more. RECALL is "did we understand the
// player"; a miss there costs him « Peux-tu répéter ? ». SAFETY is "did we
// invent an answer he never gave"; a miss there sends the game down the wrong
// branch of the book, which he cannot undo without "question". Tune for zero
// false accepts first, recall second.
//
// These transcripts are INVENTED — the forms Whisper is known to produce for a
// clipped French monosyllable — exactly like the DISTORTIONS table next door,
// and worth less than twenty lines from a real player. Collect those with
// `npm run voice:probe -- --file <recording>` and add them here.

import { readTranscript, type AnswerWord } from '@dsa/voice';

/** What the matcher should make of a transcript. RIEN: it must refuse to answer. */
export type Want = AnswerWord | 'REWIND' | 'RIEN';

export interface AnswerCase {
  heard: string;
  want: Want;
  /** Why this line is in the table, when it is not obvious. */
  note?: string;
}

export const RECALL_CASES: readonly AnswerCase[] = [
  // --- OUI, as written by a recogniser that heard 300 ms of /wi/ ---
  { heard: 'Oui', want: 'OUI' },
  { heard: 'Oui.', want: 'OUI' },
  { heard: 'Oui !', want: 'OUI' },
  { heard: 'Oui ?', want: 'OUI' },
  { heard: 'OUI', want: 'OUI' },
  { heard: 'Ouais', want: 'OUI' },
  { heard: 'Ouais.', want: 'OUI' },
  { heard: 'Ouaip', want: 'OUI' },
  { heard: 'Hui', want: 'OUI', note: 'stray aspirate: the commonest mis-write of a short oui' },
  { heard: 'Hui.', want: 'OUI' },
  { heard: 'Wi', want: 'OUI', note: 'w as /w/, which phoneticKey would send to "vi"' },
  { heard: 'Ouh', want: 'OUI' },
  { heard: 'Houi', want: 'OUI' },
  { heard: 'Ui', want: 'OUI' },
  { heard: 'Ouiii', want: 'OUI', note: 'a held ouiiii; the SOUND decides OUI vs OUIOUIOUI, not this' },
  { heard: 'Oui oui', want: 'OUI' },
  { heard: 'Ah oui', want: 'OUI' },
  { heard: 'Eh oui', want: 'OUI' },
  { heard: 'Oui, c’est ça', want: 'OUI' },
  { heard: 'Exact', want: 'OUI' },
  { heard: 'Exactement', want: 'OUI' },
  { heard: 'Tout à fait', want: 'OUI' },

  // --- NON ---
  { heard: 'Non', want: 'NON' },
  { heard: 'Non.', want: 'NON' },
  { heard: 'Non !', want: 'NON' },
  { heard: 'NON', want: 'NON' },
  { heard: 'Nan', want: 'NON' },
  { heard: 'Nan.', want: 'NON' },
  { heard: 'No', want: 'NON' },
  { heard: 'Nonn', want: 'NON' },
  { heard: 'Nooon', want: 'NON' },
  { heard: 'N’ont', want: 'NON', note: 'Whisper writes a bare non as the verb often enough' },
  { heard: 'Non non', want: 'NON' },
  { heard: 'Ah non', want: 'NON' },
  { heard: 'Non, pas du tout', want: 'NON' },
  { heard: 'Pas du tout', want: 'NON' },

  // --- JE NE SAIS PAS ---
  { heard: 'Je ne sais pas', want: 'JE_NE_SAIS_PAS' },
  { heard: 'Je ne sais pas.', want: 'JE_NE_SAIS_PAS' },
  { heard: 'Je sais pas', want: 'JE_NE_SAIS_PAS' },
  { heard: 'J’sais pas', want: 'JE_NE_SAIS_PAS' },
  { heard: 'Chais pas', want: 'JE_NE_SAIS_PAS' },
  { heard: 'Sais pas', want: 'JE_NE_SAIS_PAS' },
  { heard: 'Aucune idée', want: 'JE_NE_SAIS_PAS' },
  { heard: 'Je n’en sais rien', want: 'JE_NE_SAIS_PAS' },

  // --- QUESTION (the rewind) ---
  { heard: 'Question', want: 'REWIND' },
  { heard: 'Question.', want: 'REWIND' },
  { heard: 'Question ?', want: 'REWIND' },
  { heard: 'Questions', want: 'REWIND' },
  { heard: 'Gestion', want: 'REWIND', note: 'the voiced k: heard on every recorder' },
  { heard: 'Kestion', want: 'REWIND' },
  { heard: 'Question question', want: 'REWIND' },
  { heard: 'Question, question.', want: 'REWIND' },
];

export const SAFETY_CASES: readonly AnswerCase[] = [
  { heard: '', want: 'RIEN' },
  { heard: '...', want: 'RIEN' },

  // Whisper's subtitle boilerplate. `isLikelyHallucination` drops these before
  // the matcher ever sees them; this table checks the matcher alone, so that
  // the two guards never both have to be right at once.
  { heard: 'Merci.', want: 'RIEN' },
  { heard: 'Merci beaucoup.', want: 'RIEN' },
  { heard: 'Sous-titrage Société Radio-Canada', want: 'RIEN' },
  { heard: 'Sous-titres réalisés par la communauté d’Amara.org', want: 'RIEN' },
  { heard: 'Au revoir.', want: 'RIEN' },
  { heard: 'Bonjour.', want: 'RIEN' },

  // Short French words one letter from "non" or "oui". These are the whole
  // reason for the one-syllable rule in `answerSimilarity`.
  { heard: 'Bon', want: 'RIEN', note: 'scores 0.778 against non on raw Jaro-Winkler' },
  { heard: 'Bon.', want: 'RIEN' },
  { heard: 'Son', want: 'RIEN' },
  { heard: 'Ton', want: 'RIEN' },
  { heard: 'Mon', want: 'RIEN' },
  { heard: 'Don', want: 'RIEN' },
  { heard: 'Long', want: 'RIEN' },
  { heard: 'Nom', want: 'RIEN', note: 'one letter from non, and a word the players use' },
  { heard: 'Nous', want: 'RIEN' },
  { heard: 'Lui', want: 'RIEN' },
  { heard: 'Louis', want: 'RIEN' },
  { heard: 'Oust', want: 'RIEN' },
  { heard: 'Ouest', want: 'RIEN' },

  // The Découvreur's vocabulary: book words and names. A Tireur turn must never
  // turn one of these into an answer.
  { heard: 'Ancien', want: 'RIEN' },
  { heard: 'Homme', want: 'RIEN' },
  { heard: 'Femme', want: 'RIEN' },
  { heard: 'Pentateuque', want: 'RIEN' },
  { heard: 'Abraham', want: 'RIEN' },
  { heard: 'Absalom', want: 'RIEN' },
  { heard: 'Moïse', want: 'RIEN' },
  { heard: 'Noé', want: 'RIEN' },
  { heard: 'Onan', want: 'RIEN', note: 'a real name, and close to nan' },
  { heard: 'Esaü', want: 'RIEN' },
  { heard: 'Revenir à Ancien', want: 'RIEN' },

  // Room noise written as words.
  { heard: 'Hmm', want: 'RIEN' },
  { heard: 'Euh', want: 'RIEN' },
  { heard: 'Ah', want: 'RIEN' },
  { heard: 'Hein ?', want: 'RIEN' },
  { heard: 'Attends', want: 'RIEN' },
  { heard: 'Vas-y', want: 'RIEN' },
];

/** What `readTranscript` made of a transcript, in the table's own terms. */
export function readAs(heard: string): Want {
  const reading = readTranscript(heard);
  if (reading.rewind !== null) return 'REWIND';
  if (reading.word !== null) return reading.word;
  return 'RIEN';
}

export interface AnswerScore {
  total: number;
  /** Understood as intended. */
  right: number;
  /** Taken for a different answer than the one meant: the costly failure. */
  wrong: { heard: string; got: Want; want: Want }[];
  /** Not understood at all (only a miss when the player did say something). */
  missed: { heard: string; want: Want }[];
}

export function scoreAnswers(cases: readonly AnswerCase[]): AnswerScore {
  const score: AnswerScore = { total: cases.length, right: 0, wrong: [], missed: [] };
  for (const c of cases) {
    const got = readAs(c.heard);
    if (got === c.want) score.right++;
    else if (got === 'RIEN') score.missed.push({ heard: c.heard, want: c.want });
    else score.wrong.push({ heard: c.heard, got, want: c.want });
  }
  return score;
}
