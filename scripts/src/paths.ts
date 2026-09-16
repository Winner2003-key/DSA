// Filesystem layout of the repository, resolved from this file.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(SCRIPTS_ROOT, '..');
/** The hand transcription. Gitignored on purpose: the book stays private. */
export const BOOK_DIR = join(REPO_ROOT, 'data', 'book');
export const ENV_FILE = join(SCRIPTS_ROOT, '.env');

/** Shortens an absolute path for console output. */
export function repoRelative(file: string): string {
  return file.startsWith(`${REPO_ROOT}/`) ? file.slice(REPO_ROOT.length + 1) : file;
}
