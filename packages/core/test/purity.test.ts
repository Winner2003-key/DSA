import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/load-book';

const SRC = join(PACKAGE_ROOT, 'src');
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), 'utf8') }));

describe('package purity', () => {
  it('src imports only relative modules and uuid', () => {
    for (const { file, text } of sources) {
      const specifiers = [...text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specifiers) expect(s === 'uuid' || s?.startsWith('./'), `${file}: ${s}`).toBe(true);
    }
  });

  it('src uses no Node, DOM or React runtime APIs and no any', () => {
    const forbidden = /\b(process|window|document|Buffer|require|console|localStorage|navigator)\s*[.(]|\bReact\b|:\s*any\b|\bas any\b|<any>/;
    for (const { file, text } of sources) expect(forbidden.exec(text)?.[0], file).toBeUndefined();
  });

  it('package.json has uuid as the only runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; main: string; types: string };
    expect(Object.keys(pkg.dependencies)).toEqual(['uuid']);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['tsx', 'typescript', 'vitest']);
    expect([pkg.main, pkg.types]).toEqual(['src/index.ts', 'src/index.ts']);
  });
});
