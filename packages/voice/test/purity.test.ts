import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTION_DIR = join(ROOT, '..', '..', 'supabase', 'functions', 'transcribe');
const read = (path: string) => readFileSync(path, 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
const sources = readdirSync(join(ROOT, 'src'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: read(join(ROOT, 'src', f)) }));
const specifiers = (text: string) => [...text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('package purity', () => {
  it('src imports only relative modules and @dsa/core', () => {
    for (const { file, text } of sources) for (const s of specifiers(text)) expect(s === '@dsa/core' || s?.startsWith('./'), `${file}: ${s}`).toBe(true);
  });

  it('src uses no Node, DOM, React Native or Deno runtime APIs and no any', () => {
    const forbidden = /\b(process|window|document|Buffer|require|console|localStorage|navigator|Deno|Blob|FormData|File|AbortController)\s*[.(]|\bnew (Blob|FormData|File|Request|Response)\b|\bReact\b|react-native|:\s*any\b|\bas any\b|<any>/;
    for (const { file, text } of sources) expect(forbidden.exec(code(text))?.[0], file).toBeUndefined();
  });

  it('core.ts of the Edge Function uses no Deno globals and imports nothing', () => {
    const core = read(join(FUNCTION_DIR, 'core.ts'));
    expect(code(core)).not.toMatch(/\bDeno\b|\bprocess\b/);
    expect(specifiers(core)).toEqual([]);
    const index = read(join(FUNCTION_DIR, 'index.ts'));
    expect(specifiers(index)).toEqual(['./core.ts']);
  });

  it('the dashboard single-file bundle is up to date (npm run voice:bundle-function)', async () => {
    // @ts-expect-error plain .mjs script without types
    const { buildSingleFile } = (await import('../scripts/bundle-function.mjs')) as { buildSingleFile: (dir: string) => string };
    expect(read(join(FUNCTION_DIR, 'dashboard-single-file.ts'))).toBe(buildSingleFile(FUNCTION_DIR));
  });
});
