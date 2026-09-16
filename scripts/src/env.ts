// Environment for the scripts that talk to Supabase: scripts/.env plus the process environment.
//
// The service role key bypasses every row level security policy and DSA_ID_SALT is what makes the
// real graph's ids unguessable, so neither may ever leave this machine (GRAPH_SPECIFICATION §7).

import { existsSync, readFileSync } from 'node:fs';
import { ENV_FILE, repoRelative } from './paths';

export interface ScriptEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  idSalt: string;
}

export type EnvKey = 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'DSA_ID_SALT';

export const ENV_KEYS: readonly EnvKey[] = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DSA_ID_SALT'];

const HINTS: Record<EnvKey, string> = {
  SUPABASE_URL: 'Tableau de bord Supabase → Project Settings → API (Data API) → Project URL',
  SUPABASE_SERVICE_ROLE_KEY: 'Tableau de bord Supabase → Project Settings → API Keys → service_role (clé secrète)',
  DSA_ID_SALT: 'à générer UNE seule fois : node -e "console.log(crypto.randomUUID())", puis à conserver pour toujours',
};

export class EnvError extends Error {
  readonly missing: EnvKey[];
  constructor(missing: EnvKey[], file: string) {
    const lines = [
      `Variables d'environnement manquantes : ${missing.join(', ')}.`,
      `Renseignez-les dans ${repoRelative(file)} (copiez scripts/.env.example) ou exportez-les dans le terminal :`,
      ...missing.map((k) => `  ${k}= …   # ${HINTS[k]}`),
      'Voir IMPORT_GUIDE.md. Ce fichier est ignoré par git et ne doit jamais être partagé.',
    ];
    super(lines.join('\n'));
    this.name = 'EnvError';
    this.missing = missing;
  }
}

/** Parses a `.env` file: `KEY=value`, optional `export`, `#` comments, single or double quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as string;
    let value = (m[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    out[key] = value;
  }
  return out;
}

export function readEnvFile(file: string = ENV_FILE): Record<string, string> {
  return existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {};
}

/** Merges the two sources (the process environment wins) and checks the required keys. */
export function resolveEnv(
  fileVars: Record<string, string | undefined>,
  processVars: Record<string, string | undefined>,
  need: readonly EnvKey[] = ENV_KEYS,
  file: string = ENV_FILE,
): ScriptEnv {
  const get = (k: EnvKey): string => (processVars[k] ?? fileVars[k] ?? '').trim();
  const missing = need.filter((k) => get(k) === '');
  if (missing.length > 0) throw new EnvError(missing, file);
  return { supabaseUrl: get('SUPABASE_URL'), serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY'), idSalt: get('DSA_ID_SALT') };
}

export function loadEnv(need: readonly EnvKey[] = ENV_KEYS, file: string = ENV_FILE): ScriptEnv {
  return resolveEnv(readEnvFile(file), process.env, need, file);
}

/** The salt alone, for commands that only build the graph locally. */
export function loadIdSalt(file: string = ENV_FILE): string | null {
  const vars = { ...readEnvFile(file), ...process.env };
  const salt = (vars.DSA_ID_SALT ?? '').trim();
  return salt === '' ? null : salt;
}
