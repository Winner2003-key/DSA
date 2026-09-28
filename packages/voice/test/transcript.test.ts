import { describe, expect, it } from 'vitest';
import { isLikelyHallucination } from '../src';

describe('isLikelyHallucination', () => {
  it('discards the subtitle boilerplate Whisper returns for silence', () => {
    for (const text of [
      'Sous-titrage Société Radio-Canada',
      'Sous-titres réalisés par la communauté d’Amara.org',
      'Merci d’avoir regardé cette vidéo !',
      'Abonnez-vous !',
      '',
      '   ',
    ]) {
      expect(isLikelyHallucination(text), text).toBe(true);
    }
  });

  it('discards a bare pleasantry, but not one inside real speech', () => {
    expect(isLikelyHallucination('Merci.')).toBe(true);
    expect(isLikelyHallucination('Au revoir')).toBe(true);
    expect(isLikelyHallucination('Merci, c’est Absalom')).toBe(false);
  });

  it('never discards what a player actually says', () => {
    for (const text of [
      'Oui',
      'Non',
      'Je ne sais pas',
      'Question question',
      'Ancien ?',
      'Pentateuque ?',
      'Lié à David ?',
      'Absalom !',
      'Revenir à Pentateuque',
      'Ouiiiii',
    ]) {
      expect(isLikelyHallucination(text), text).toBe(false);
    }
  });
});
