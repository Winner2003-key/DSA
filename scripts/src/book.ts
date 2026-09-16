// Reads data/book and builds the book graph with @dsa/core.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraphData, parsePage, parseSpine } from '@dsa/core';
import type { BuildOptions, BuildReport, GraphData, ParsedPage, ParsedSpine, ReviewStatus } from '@dsa/core';
import { BOOK_DIR, repoRelative } from './paths';

export const DEFAULT_GRAPH_SLUG = 'livre';
export const DEFAULT_GRAPH_NAME = 'DSA — Découverte Sans Alphabet';
/** The PDF itself is deliberately not in the repository. */
export const SOURCE_DOCUMENT = 'Livre source (hors dépôt)';

export interface LoadedBook {
  spine: ParsedSpine;
  pages: ParsedPage[];
  /** `@page` numbers found in the transcription, sorted. */
  pageNumbers: number[];
}

export interface BuiltBook extends LoadedBook {
  data: GraphData;
  report: BuildReport;
}

export function readBookDir(dir: string = BOOK_DIR): LoadedBook {
  const spineFile = join(dir, 'spine.dsa');
  if (!existsSync(spineFile)) {
    throw new Error(
      `Transcription introuvable : ${repoRelative(spineFile)}.\n` +
        "data/book/ est ignoré par git (le livre reste privé) ; il doit exister sur cette machine.",
    );
  }
  const spine = parseSpine(readFileSync(spineFile, 'utf8'), repoRelative(spineFile));
  const pagesDir = join(dir, 'pages');
  const files = existsSync(pagesDir)
    ? readdirSync(pagesDir)
        .filter((f) => f.endsWith('.dsa'))
        .sort()
    : [];
  const pages = files.map((f) => parsePage(readFileSync(join(pagesDir, f), 'utf8'), repoRelative(join(pagesDir, f))));
  const pageNumbers = [...new Set(pages.map((p) => p.page).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  return { spine, pages, pageNumbers };
}

export interface BuildBookOptions {
  graphSlug?: string;
  graphName?: string;
  /** The private DSA_ID_SALT. Required for every graph except `mini`. */
  idSalt?: string | null;
  /** Local checks only: build without a salt instead of throwing (ids then differ from the database). */
  allowUnsalted?: boolean;
  defaultReviewStatus?: ReviewStatus;
  dir?: string;
}

export function buildBook(opts: BuildBookOptions = {}): BuiltBook {
  const book = readBookDir(opts.dir ?? BOOK_DIR);
  const buildOptions: BuildOptions = {
    graphName: opts.graphName ?? DEFAULT_GRAPH_NAME,
    sourceDocument: SOURCE_DOCUMENT,
    idSalt: opts.idSalt ?? null,
    allowUnsalted: opts.allowUnsalted === true,
    ...(opts.defaultReviewStatus ? { defaultReviewStatus: opts.defaultReviewStatus } : {}),
  };
  const { data, report } = buildGraphData(opts.graphSlug ?? DEFAULT_GRAPH_SLUG, book.spine, book.pages, buildOptions);
  return { ...book, data, report };
}
