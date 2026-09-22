/**
 * The single `app_settings` row (GRAPH_SPECIFICATION §9): the durations of a
 * timed game and how many times a Tireur may draw another name.
 *
 * Only admins may read or write it (RLS, DATABASE_SCHEMA.md §2). Players never
 * touch this table: the RPCs read it as the owner, and copy what a game needs
 * into `game_sessions.settings` when the game is created — so changing a value
 * here never disturbs a game already being played.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RepositoryError } from './graph-repository';

export interface AppSettings {
  thinkSeconds: number;
  playSeconds: number;
  maxRedraws: number;
  updatedAt: string | null;
}

export interface SettingsBound {
  min: number;
  max: number;
}

/** The CHECK constraints of `app_settings`, repeated here so the form can say them. */
export const SETTINGS_BOUNDS: Record<'thinkSeconds' | 'playSeconds' | 'maxRedraws', SettingsBound> = {
  thinkSeconds: { min: 10, max: 600 },
  playSeconds: { min: 30, max: 1800 },
  maxRedraws: { min: 0, max: 5 },
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  thinkSeconds: 40,
  playSeconds: 120,
  maxRedraws: 2,
  updatedAt: null,
};

export type SettingsField = keyof typeof SETTINGS_BOUNDS;

/** Null when the value is fine, otherwise the French line to show under the field. */
export function validateSetting(field: SettingsField, value: number): string | null {
  const { min, max } = SETTINGS_BOUNDS[field];
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 'Entrez un nombre entier.';
  if (value < min || value > max) return `La valeur doit être comprise entre ${min} et ${max}.`;
  return null;
}

export function validateSettings(settings: Pick<AppSettings, SettingsField>): Partial<Record<SettingsField, string>> {
  const errors: Partial<Record<SettingsField, string>> = {};
  for (const field of Object.keys(SETTINGS_BOUNDS) as SettingsField[]) {
    const message = validateSetting(field, settings[field]);
    if (message) errors[field] = message;
  }
  return errors;
}

/** "40 s", "2 min", "1 min 12 s" — the same wording the game uses. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest} s`;
  if (rest === 0) return `${minutes} min`;
  return `${minutes} min ${rest} s`;
}

export interface SettingsRepository {
  readonly readOnly: boolean;
  load(): Promise<AppSettings>;
  save(settings: Pick<AppSettings, SettingsField>): Promise<AppSettings>;
}

interface SettingsRow {
  think_seconds: number;
  play_seconds: number;
  max_redraws: number;
  updated_at: string | null;
}

const COLUMNS = 'think_seconds, play_seconds, max_redraws, updated_at';

function toSettings(row: SettingsRow): AppSettings {
  return {
    thinkSeconds: row.think_seconds,
    playSeconds: row.play_seconds,
    maxRedraws: row.max_redraws,
    updatedAt: row.updated_at,
  };
}

export function createSupabaseSettingsRepository(supabase: SupabaseClient): SettingsRepository {
  return {
    readOnly: false,

    async load() {
      const { data, error } = await supabase.from('app_settings').select(COLUMNS).limit(1).maybeSingle();
      if (error) throw new RepositoryError(`Lecture des réglages impossible : ${error.message}`, error);
      // 0009 seeds the row; a project that has not run it yet shows the defaults.
      return data ? toSettings(data as unknown as SettingsRow) : { ...DEFAULT_APP_SETTINGS };
    },

    async save(settings) {
      const invalid = validateSettings(settings);
      const first = Object.values(invalid)[0];
      if (first) throw new RepositoryError(first);

      const { data, error } = await supabase
        .from('app_settings')
        .update({
          think_seconds: settings.thinkSeconds,
          play_seconds: settings.playSeconds,
          max_redraws: settings.maxRedraws,
        })
        .eq('id', true)
        .select(COLUMNS)
        .maybeSingle();

      if (error) throw new RepositoryError(`Enregistrement des réglages impossible : ${error.message}`, error);
      if (!data) {
        // RLS returned no row: the account is not in `admin_users`.
        throw new RepositoryError('Les réglages n’ont pas été enregistrés : ce compte n’est pas administrateur.');
      }
      return toSettings(data as unknown as SettingsRow);
    },
  };
}

/**
 * Mock mode: the values live in process memory, like the mock graph, so the page
 * can be opened and the form exercised with no Supabase project.
 */
const holder = globalThis as typeof globalThis & { __dsaMockSettings?: AppSettings };

export function createMockSettingsRepository(): SettingsRepository {
  return {
    readOnly: false,
    async load() {
      holder.__dsaMockSettings ??= { ...DEFAULT_APP_SETTINGS };
      return { ...holder.__dsaMockSettings };
    },
    async save(settings) {
      const invalid = validateSettings(settings);
      const first = Object.values(invalid)[0];
      if (first) throw new RepositoryError(first);
      holder.__dsaMockSettings = { ...settings, updatedAt: new Date().toISOString() };
      return { ...holder.__dsaMockSettings };
    },
  };
}
