'use client';

import { useEffect, useState } from 'react';
import { RepositoryError } from '../lib/graph-repository';
import { getBrowserSettingsRepository } from '../lib/settings-browser';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_BOUNDS,
  formatDuration,
  validateSetting,
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
];

type Draft = Record<SettingsField, string>;

const toDraft = (settings: AppSettings): Draft => ({
  thinkSeconds: String(settings.thinkSeconds),
  playSeconds: String(settings.playSeconds),
  maxRedraws: String(settings.maxRedraws),
});

/**
 * The admin's "Réglages" page (GRAPH_SPECIFICATION §9): the three values of
 * `app_settings`.
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
  };
  const errors: Partial<Record<SettingsField, string>> = {};
  for (const { field } of FIELDS) {
    const message = draft[field].trim() === '' ? 'Entrez un nombre entier.' : validateSetting(field, numbers[field]);
    if (message) errors[field] = message;
  }
  const invalid = Object.keys(errors).length > 0;
  const changed = FIELDS.some(({ field }) => numbers[field] !== saved[field]);

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setSaveError(null);
    setToast(null);
    try {
      const next = await (await getBrowserSettingsRepository()).save(numbers);
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
            {FIELDS.map(({ field, label, help, asDuration }) => {
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
            })}

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
        Ces trois valeurs sont la ligne unique de la table <code className="rounded-xs bg-surface-sunk px-1">app_settings</code>. Seuls les
        administrateurs peuvent les modifier.
      </p>
    </main>
  );
}
