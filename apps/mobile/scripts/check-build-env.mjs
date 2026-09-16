#!/usr/bin/env node
// Runs before the web build on Vercel. EXPO_PUBLIC_* values are written into the site at build time,
// so a build without them publishes an app that can't reach its server ("il manque l'adresse du
// serveur"). This stops the build instead, and prints variable NAMES only, never their values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const OPTIONAL = ['EXPO_PUBLIC_DSA_GRAPH_SLUG', 'EXPO_PUBLIC_DSA_OFFLINE'];

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Local builds get their values from .env files (loaded by the Expo CLI), so count those too.
const fromFiles = new Map();
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const full = path.join(appDir, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[2].replace(/^["']|["']$/g, '').trim() !== '') fromFiles.set(m[1], file);
  }
}

const present = (name) => (process.env[name] ?? '').trim() !== '' || fromFiles.has(name);
const where = (name) => ((process.env[name] ?? '').trim() !== '' ? 'environment' : fromFiles.get(name));

console.log(`DSA build check — Vercel environment: ${process.env.VERCEL_ENV ?? '(not on Vercel)'}`);
for (const name of [...REQUIRED, ...OPTIONAL]) {
  console.log(`  ${present(name) ? '✓' : REQUIRED.includes(name) ? '✗' : '·'} ${name}${present(name) ? ` (${where(name)})` : ''}`);
}

const missing = REQUIRED.filter((name) => !present(name));
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
if (url && !/^https:\/\/\S+$/.test(url)) {
  console.error('✗ EXPO_PUBLIC_SUPABASE_URL must start with https:// and contain no spaces or quotes.');
  process.exit(1);
}
if (missing.length > 0) {
  console.error(`\n✗ Missing: ${missing.join(', ')}`);
  console.error('  Vercel → Project → Settings → Environment Variables: add them with the exact names above,');
  console.error(`  tick the "${process.env.VERCEL_ENV ?? 'Production'}" environment, then redeploy.`);
  process.exit(1);
}
console.log('✓ Supabase settings present; building.');
