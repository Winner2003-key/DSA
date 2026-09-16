// Node-side helpers (tests and scripts only): read .dsa files from disk and build GraphData.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraphData, parsePage, parseSpine } from '../src/index';
import type { BuildOptions, GraphData, BuildReport, ParsedPage, ParsedSpine } from '../src/index';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
export const MINI_DIR = join(PACKAGE_ROOT, 'fixtures', 'mini');
export const MINI_JSON = join(PACKAGE_ROOT, 'fixtures', 'mini-graph.json');
export const BOOK_DIR = join(REPO_ROOT, 'data', 'book');

export interface LoadedBook {
  spine: ParsedSpine;
  pages: ParsedPage[];
}

/** Reads `<dir>/spine.dsa` and every `<dir>/pages/*.dsa` (sorted by file name). */
export function readBookDir(dir: string): LoadedBook {
  const spineFile = join(dir, 'spine.dsa');
  const spine = parseSpine(readFileSync(spineFile, 'utf8'), relative(spineFile));
  const pagesDir = join(dir, 'pages');
  const files = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith('.dsa')).sort() : [];
  const pages = files.map((f) => parsePage(readFileSync(join(pagesDir, f), 'utf8'), relative(join(pagesDir, f))));
  return { spine, pages };
}

export function buildBookDir(graphSlug: string, dir: string, opts?: BuildOptions): LoadedBook & { data: GraphData; report: BuildReport } {
  const book = readBookDir(dir);
  return { ...book, ...buildGraphData(graphSlug, book.spine, book.pages, opts) };
}

export const MINI_BUILD_OPTIONS: BuildOptions = {
  defaultReviewStatus: 'APPROVED',
  graphName: 'DSA mini',
  graphStatus: 'PUBLISHED',
  sourceDocument: null,
};

export function buildMini() {
  return buildBookDir('mini', MINI_DIR, MINI_BUILD_OPTIONS);
}

export function serializeGraph(data: GraphData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function relative(file: string): string {
  return file.startsWith(`${REPO_ROOT}/`) ? file.slice(REPO_ROOT.length + 1) : file;
}
