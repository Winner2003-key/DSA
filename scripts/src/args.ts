// Command-line parsing. Unknown flags are refused rather than silently ignored, because a typo in
// `--aply` would otherwise run a dry run that the owner believes is a real import.

import { DEFAULT_GRAPH_NAME, DEFAULT_GRAPH_SLUG } from './book';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface Token {
  name: string;
  value: string | null;
}

function tokenize(argv: string[], valueFlags: ReadonlySet<string>): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) throw new UsageError(`argument inattendu « ${arg} » (les options commencent par --)`);
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (eq >= 0) {
      tokens.push({ name, value: arg.slice(eq + 1) });
      continue;
    }
    if (valueFlags.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`l'option --${name} attend une valeur`);
      i++;
      tokens.push({ name, value: next });
      continue;
    }
    tokens.push({ name, value: null });
  }
  return tokens;
}

function check(tokens: Token[], known: ReadonlySet<string>): void {
  for (const t of tokens) if (!known.has(t.name)) throw new UsageError(`option inconnue « --${t.name} »`);
}

const has = (tokens: Token[], name: string): boolean => tokens.some((t) => t.name === name);
const value = (tokens: Token[], name: string): string | null => {
  const found = [...tokens].reverse().find((t) => t.name === name);
  return found ? found.value : null;
};

/** `--pages 8,9,23` or `--pages 8-12,23`. */
export function parsePages(spec: string): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(',').map((p) => p.trim()).filter((p) => p !== '')) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from) throw new UsageError(`plage de pages invalide « ${part} »`);
      for (let p = from; p <= to; p++) pages.add(p);
      continue;
    }
    if (!/^\d+$/.test(part)) throw new UsageError(`page invalide « ${part} » (attendu : 8,9,23 ou 8-12)`);
    pages.add(Number(part));
  }
  if (pages.size === 0) throw new UsageError('--pages attend au moins une page');
  return [...pages].sort((a, b) => a - b);
}

export interface ImportArgs {
  graph: string;
  name: string;
  dryRun: boolean;
  pages: number[] | null;
  approve: boolean;
  publish: boolean;
  prune: boolean;
  json: string | null;
  /** Write the VALIDATED `import_batches` rows of a dry run (a dry run writes nothing by default). */
  recordDryRun: boolean;
  batchSize: number | null;
  help: boolean;
}

const IMPORT_VALUE_FLAGS = new Set(['graph', 'name', 'pages', 'json', 'batch-size']);
const IMPORT_FLAGS = new Set([...IMPORT_VALUE_FLAGS, 'dry-run', 'apply', 'approve', 'publish', 'prune', 'record-dry-run', 'help']);

export function parseImportArgs(argv: string[]): ImportArgs {
  const tokens = tokenize(argv, IMPORT_VALUE_FLAGS);
  check(tokens, IMPORT_FLAGS);
  const apply = has(tokens, 'apply');
  if (apply && has(tokens, 'dry-run')) throw new UsageError('--apply et --dry-run s’excluent');
  const pages = value(tokens, 'pages');
  const batch = value(tokens, 'batch-size');
  if (batch !== null && !/^\d+$/.test(batch)) throw new UsageError('--batch-size attend un nombre');
  return {
    graph: value(tokens, 'graph') ?? DEFAULT_GRAPH_SLUG,
    name: value(tokens, 'name') ?? DEFAULT_GRAPH_NAME,
    dryRun: !apply,
    pages: pages === null ? null : parsePages(pages),
    approve: has(tokens, 'approve'),
    publish: has(tokens, 'publish'),
    prune: has(tokens, 'prune'),
    json: value(tokens, 'json'),
    recordDryRun: has(tokens, 'record-dry-run'),
    batchSize: batch === null ? null : Number(batch),
    help: has(tokens, 'help'),
  };
}

export interface ValidateArgs {
  graph: string;
  /** `--approved`: pretend every row is approved, to see how many characters would be playable. */
  approved: boolean;
  json: string | null;
  help: boolean;
}

const VALIDATE_VALUE_FLAGS = new Set(['graph', 'json']);
const VALIDATE_FLAGS = new Set([...VALIDATE_VALUE_FLAGS, 'approved', 'help']);

export function parseValidateArgs(argv: string[]): ValidateArgs {
  const tokens = tokenize(argv, VALIDATE_VALUE_FLAGS);
  check(tokens, VALIDATE_FLAGS);
  return {
    graph: value(tokens, 'graph') ?? DEFAULT_GRAPH_SLUG,
    approved: has(tokens, 'approved'),
    json: value(tokens, 'json'),
    help: has(tokens, 'help'),
  };
}

export interface ExportArgs {
  graph: string;
  out: string | null;
  help: boolean;
}

const EXPORT_VALUE_FLAGS = new Set(['graph', 'out']);
const EXPORT_FLAGS = new Set([...EXPORT_VALUE_FLAGS, 'help']);

export function parseExportArgs(argv: string[]): ExportArgs {
  const tokens = tokenize(argv, EXPORT_VALUE_FLAGS);
  check(tokens, EXPORT_FLAGS);
  return { graph: value(tokens, 'graph') ?? DEFAULT_GRAPH_SLUG, out: value(tokens, 'out'), help: has(tokens, 'help') };
}
