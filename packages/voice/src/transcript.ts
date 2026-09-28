// Whisper talking to itself rather than to the player.
//
// Trained on subtitle corpora, it answers silence and background noise with the
// credits that ended those clips: a held breath comes back as "Merci.", a second
// of room tone as "Sous-titrage Société Radio-Canada". A voice game has no
// buttons, so one of these reaching the matcher costs the player a turn — and
// the longer ones carry enough letters to fuzzy-match a book name outright.
//
// Checked against the whole book before being written down: none of the phrases
// below is a name, an alias or a question label.

import { normalizeText } from '@dsa/core';

/**
 * Subtitle boilerplate, matched anywhere in the transcript. These are never part
 * of an utterance a player could make, so a substring is enough.
 */
const HALLUCINATION_MARKERS = [
  'sous titrage',
  'sous titres',
  'soustitrage',
  'amara',
  'radio canada',
  'abonnez vous',
  "merci d'avoir regarde",
  'a tous et a bientot',
  'realises par la communaute',
  'traduit par',
];

/**
 * Pleasantries Whisper returns for silence. Matched only against the WHOLE
 * transcript: "merci" inside a longer utterance is somebody speaking.
 */
const HALLUCINATION_EXACT = [
  'merci',
  'merci beaucoup',
  'merci a tous',
  'au revoir',
  'a bientot',
  'bonjour',
  'bonsoir',
  'a plus tard',
];

/**
 * True when the transcript is the recogniser's boilerplate rather than speech.
 *
 * Deliberately conservative — known boilerplate anywhere, or a bare pleasantry
 * that is the entire transcript. A real utterance is never discarded. An empty
 * transcript counts too: there is nothing to interpret either way.
 */
export function isLikelyHallucination(text: string): boolean {
  const cleaned = normalizeText(text);
  if (cleaned === '') return true;
  if (HALLUCINATION_EXACT.includes(cleaned)) return true;
  return HALLUCINATION_MARKERS.some((marker) => cleaned.includes(marker));
}
