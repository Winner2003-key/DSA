'use client';

import { useEffect, useState } from 'react';
import { RepositoryError } from '../lib/graph-repository';
import { getBrowserSettingsRepository } from '../lib/settings-browser';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_BOUNDS,
  formatDuration,
  validateSetting,
  validateTimezone,
  type AppSettings,
  type SettingsField,
} from '../lib/settings-repository';
import { Notice } from './ui';

interface FieldSpec {
  field: SettingsField;
  label: string;
  help: string;
  /** Written as a duration under the field, so "120" reads as "2 min". */
  asDuration: boolean;
  /** "call" fields sit in their own group, under their own heading. */
  group?: 'game' | 'call';
}

const FIELDS: FieldSpec[] = [
  {
    field: 'thinkSeconds',
    label: 'Temps pour réfléchir (secondes)',
    help: 'Quand le Tireur reçoit son nom, il a ce temps pour trouver le chemin du livre jusqu’à lui. « Je suis prêt » l’arrête plus tôt.',
    asDuration: true,
  },
  {
    field: 'playSeconds',
    label: 'Temps pour trouver (secondes)',
    help: 'Le temps de la partie, une fois la réflexion terminée. Si le nom n’est pas découvert à temps, les deux joueurs perdent. Rien ne l’allonge : les retours et les noms proposés se paient sur ce temps.',
    asDuration: true,
  },
  {
    field: 'maxRedraws',
    label: 'Changements de nom autorisés',
    help: 'Si le Tireur ne trouve pas son nom dans le livre, il peut en tirer un autre, avant le début des questions seulement. 0 supprime cette possibilité.',
    asDuration: false,
  },
  // In a room, « Voix » means the two players are on a live call. Calls cost
  // minutes at the provider, so three numbers keep them inside the free tier.
  {
    field: 'callMaxSeconds',
    label: 'Durée maximale d’un appel (secondes)',
    help: 'Une partie dure environ 2 minutes. Passé ce temps, la partie se termine pour les deux joueurs (« Temps d’appel écoulé ») et l’appel se ferme.',
    asDuration: true,
    group: 'call',
  },
  {
    field: 'callDailyMinutesPerPlayer',
    label: 'Minutes d’appel par joueur et par jour',
    help: 'Seules les minutes jouées comptent, pour les deux joueurs. En dessous d’une minute restante, « Voix » n’est plus proposé dans les salles ce jour-là ; « Boutons » reste disponible.',
    asDuration: false,
    group: 'call',
  },
  {
    field: 'callMonthlyBudgetMinutes',
    label: 'Budget d’appel du mois (minutes)',
    help: 'Le budget de toute l’application, chaque téléphone compté. Quand il est épuisé, les nouveaux appels sont refusés avec un message clair et « Boutons » continue de marcher.',
    asDuration: false,
    group: 'call',
  },
];

type Draft = Record<SettingsField | 'callDayTimezone', string>;

const toDraft = (settings: AppSettings): Draft => ({
  thinkSeconds: String(settings.thinkSeconds),
  playSeconds: String(settings.playSeconds),
  maxRedraws: String(settings.maxRedraws),
  callMaxSeconds: String(settings.callMaxSeconds),
  callDailyMinutesPerPlayer: String(settings.callDailyMinutesPerPlayer),
  callMonthlyBudgetMinutes: String(settings.callMonthlyBudgetMinutes),
  callDayTimezone: settings.callDayTimezone,
});

/**
 * The admin's "Réglages" page: the values of `app_settings` — the timed game
 * (GRAPH_SPECIFICATION §9) and the limits of a call in a room played with Voix
 * (GAME_RULES "Call limits").
 *
 * They are the defaults a NEW game copies. A game already being played keeps the
 * values it was created with, so saving here never shortens anyone's clock — the
 * page says so, because that is the question an admin will ask.
 */
export function SettingsForm() {
  const [saved, setSaved] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_APP_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await (await getBrowserSettingsRepository()).load();
        if (cancelled) return;
        setSaved(settings);
        setDraft(toDraft(settings));
        setLoadError(null);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof RepositoryError ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const numbers = {
    thinkSeconds: Number(draft.thinkSeconds),
    playSeconds: Number(draft.playSeconds),
    maxRedraws: Number(draft.maxRedraws),
    callMaxSeconds: Number(draft.callMaxSeconds),
    callDailyMinutesPerPlayer: Number(draft.callDailyMinutesPerPlayer),
    callMonthlyBudgetMinutes: Number(draft.callMonthlyBudgetMinutes),
  };
  const errors: Partial<Record<SettingsField | 'callDayTimezone', string>> = {};
  for (const { field } of FIELDS) {
    const message = draft[field].trim() === '' ? 'Entrez un nombre entier.' : validateSetting(field, numbers[field]);
    if (message) errors[field] = message;
  }
  const timezoneError = validateTimezone(draft.callDayTimezone);
  if (timezoneError) errors.callDayTimezone = timezoneError;
  const invalid = Object.keys(errors).length > 0;
  const changed =
    FIELDS.some(({ field }) => numbers[field] !== saved[field]) ||
    draft.callDayTimezone.trim() !== saved.callDayTimezone;

  /** One group of numeric fields; every one of them looks and behaves the same. */
  const numberFields = (group: 'game' | 'call') =>
    FIELDS.filter((spec) => (spec.group ?? 'game') === group).map(({ field, label, help, asDuration }) => {
      const bound = SETTINGS_BOUNDS[field];
      const error = errors[field];
      return (
        <div key={field}>
          <label className="field-label" htmlFor={`setting-${field}`}>
            {label}
          </label>
          <input
            id={`setting-${field}`}
            data-testid={`setting-${field}`}
            className="field tabular max-w-[10rem]"
            type="number"
            inputMode="numeric"
            min={bound.min}
            max={bound.max}
            step={1}
            value={draft[field]}
            aria-invalid={error ? true : undefined}
            aria-describedby={`setting-${field}-help`}
            disabled={saving}
            onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
          />
          <p id={`setting-${field}-help`} className="mt-1 text-[11px] text-ink-faint">
            Entre {bound.min} et {bound.max}
            {asDuration && !error ? ` · ${formatDuration(numbers[field])}` : ''}. {help}
          </p>
          {error && (
            <p className="mt-1 text-[11px] text-rejected" data-testid={`setting-${field}-error`}>
              {error}
            </p>
          )}
        </div>
      );
    });

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setSaveError(null);
    setToast(null);
    try {
      const next = await (await getBrowserSettingsRepository()).save({
        ...numbers,
        callDayTimezone: draft.callDayTimezone.trim(),
      });
      setSaved(next);
      setDraft(toDraft(next));
      setToast('Réglages enregistrés.');
    } catch (error) {
      setSaveError(error instanceof RepositoryError ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8" data-testid="reglages">
      <h1 className="text-xl font-semibold tracking-tight">Réglages du jeu</h1>
      <p className="mt-2 text-ink-soft">
        Le chronomètre est facultatif : les joueurs le choisissent partie par partie. Ces valeurs sont celles qu’une{' '}
        <strong className="font-medium text-ink">nouvelle</strong> partie prendra. Une partie en cours garde les siennes.
      </p>

      {loadError && (
        <div className="mt-4">
          <Notice tone="error">{loadError}</Notice>
        </div>
      )}

      <div className="panel mt-6 rounded-md px-5 py-4">
        {loading ? (
          <p className="text-ink-soft">Lecture des réglages…</p>
        ) : (
          <div className="flex flex-col gap-5">
            {numberFields('game')}

            {/* In a room, « Voix » is a live call. These three keep it affordable. */}
            <div className="border-t border-line pt-5">
              <h2 className="font-medium">L’appel des salles en « Voix »</h2>
              <p className="mt-1 text-[11px] text-ink-faint">
                Dans une salle à deux téléphones, « Voix » met les joueurs en appel. Les limites ne sont vérifiées{' '}
                <strong className="font-medium text-ink">qu’au début</strong> d’une partie : une partie en cours n’est
                jamais coupée avant son propre temps d’appel.
              </p>
            </div>
            {numberFields('call')}

            <div>
              <label className="field-label" htmlFor="setting-callDayTimezone">
                Fuseau horaire du changement de jour
              </label>
              <input
                id="setting-callDayTimezone"
                data-testid="setting-callDayTimezone"
                className="field max-w-[16rem]"
                type="text"
                value={draft.callDayTimezone}
                aria-invalid={errors.callDayTimezone ? true : undefined}
                aria-describedby="setting-callDayTimezone-help"
                disabled={saving}
                onChange={(event) => setDraft((current) => ({ ...current, callDayTimezone: event.target.value }))}
              />
              <p id="setting-callDayTimezone-help" className="mt-1 text-[11px] text-ink-faint">
                Les minutes de chaque joueur repartent à zéro à minuit dans ce fuseau. Par exemple{' '}
                <code className="rounded-xs bg-surface-sunk px-1">UTC</code> ou{' '}
                <code className="rounded-xs bg-surface-sunk px-1">Africa/Abidjan</code>.
              </p>
              {errors.callDayTimezone && (
                <p className="mt-1 text-[11px] text-rejected" data-testid="setting-callDayTimezone-error">
                  {errors.callDayTimezone}
                </p>
              )}
            </div>

            {saveError && <Notice tone="error">{saveError}</Notice>}
            {toast && <Notice tone="ok">{toast}</Notice>}

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="settings-save"
                disabled={invalid || saving || !changed}
                onClick={() => void save()}
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="settings-reset"
                disabled={saving || !changed}
                onClick={() => {
                  setDraft(toDraft(saved));
                  setSaveError(null);
                  setToast(null);
                }}
              >
                Annuler
              </button>
              {saved.updatedAt && (
                <span className="text-[11px] text-ink-faint">
                  Modifié le {new Date(saved.updatedAt).toLocaleString('fr-FR')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-[11px] text-ink-faint">
        Ces valeurs sont la ligne unique de la table <code className="rounded-xs bg-surface-sunk px-1">app_settings</code>. Seuls les
        administrateurs peuvent les modifier.
      </p>
    </main>
  );
}
