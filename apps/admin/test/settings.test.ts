/**
 * The "Réglages" page's rules (GRAPH_SPECIFICATION §9): the bounds are the ones
 * the database enforces, and the mock repository behaves like the real one so
 * the page can be worked on with no Supabase project.
 */
import { describe, expect, it } from 'vitest';
import { RepositoryError } from '../src/lib/graph-repository';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_BOUNDS,
  createMockSettingsRepository,
  formatDuration,
  validateSetting,
  validateSettings,
} from '../src/lib/settings-repository';

describe('the bounds', () => {
  it('are the CHECK constraints of app_settings', () => {
    expect(SETTINGS_BOUNDS).toEqual({
      thinkSeconds: { min: 10, max: 600 },
      playSeconds: { min: 30, max: 1800 },
      maxRedraws: { min: 0, max: 5 },
    });
  });

  it('accepts the defaults and both ends of each range', () => {
    expect(validateSettings(DEFAULT_APP_SETTINGS)).toEqual({});
    expect(validateSetting('thinkSeconds', 10)).toBeNull();
    expect(validateSetting('thinkSeconds', 600)).toBeNull();
    expect(validateSetting('playSeconds', 30)).toBeNull();
    expect(validateSetting('playSeconds', 1800)).toBeNull();
    expect(validateSetting('maxRedraws', 0)).toBeNull();
    expect(validateSetting('maxRedraws', 5)).toBeNull();
  });

  it('refuses anything outside them, and anything that is not a whole number', () => {
    expect(validateSetting('thinkSeconds', 9)).toBe('La valeur doit être comprise entre 10 et 600.');
    expect(validateSetting('thinkSeconds', 601)).toBe('La valeur doit être comprise entre 10 et 600.');
    expect(validateSetting('playSeconds', 29)).toBe('La valeur doit être comprise entre 30 et 1800.');
    expect(validateSetting('maxRedraws', -1)).toBe('La valeur doit être comprise entre 0 et 5.');
    expect(validateSetting('maxRedraws', 6)).toBe('La valeur doit être comprise entre 0 et 5.');
    expect(validateSetting('thinkSeconds', 40.5)).toBe('Entrez un nombre entier.');
    expect(validateSetting('thinkSeconds', Number.NaN)).toBe('Entrez un nombre entier.');
  });

  it('names every field that is wrong, not just the first', () => {
    expect(validateSettings({ thinkSeconds: 5, playSeconds: 5, maxRedraws: 9 })).toEqual({
      thinkSeconds: 'La valeur doit être comprise entre 10 et 600.',
      playSeconds: 'La valeur doit être comprise entre 30 et 1800.',
      maxRedraws: 'La valeur doit être comprise entre 0 et 5.',
    });
  });
});

describe('the durations, written out', () => {
  it('reads as the game says them', () => {
    expect(formatDuration(40)).toBe('40 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(72)).toBe('1 min 12 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(0)).toBe('0 s');
  });
});

describe('the mock repository', () => {
  it('keeps what it was given, and refuses what the database would', async () => {
    const repository = createMockSettingsRepository();
    const initial = await repository.load();
    expect(initial).toMatchObject({ thinkSeconds: 40, playSeconds: 120, maxRedraws: 2 });

    const saved = await repository.save({ thinkSeconds: 90, playSeconds: 300, maxRedraws: 4 });
    expect(saved).toMatchObject({ thinkSeconds: 90, playSeconds: 300, maxRedraws: 4 });
    expect(saved.updatedAt).not.toBeNull();
    expect(await repository.load()).toMatchObject({ thinkSeconds: 90, playSeconds: 300, maxRedraws: 4 });

    await expect(repository.save({ thinkSeconds: 5, playSeconds: 300, maxRedraws: 4 })).rejects.toBeInstanceOf(
      RepositoryError,
    );
    // …and a refused save changes nothing.
    expect(await repository.load()).toMatchObject({ thinkSeconds: 90 });
  });
});
