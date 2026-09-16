import { v5 as uuidv5 } from 'uuid';
import { answerClass } from './answers';
import { stripAccents } from './normalize';

export const KEY_NAMESPACE = '6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a';

/** Lowercase ASCII, accents stripped, non-alphanumerics → '-', dashes collapsed and trimmed. */
export function slugify(label: string): string {
  return stripAccents(label.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function answerSlug(label: string): string {
  switch (answerClass(label)) {
    case 'OUI':
      return 'oui';
    case 'NON':
      return 'non';
    case 'OUI_REPETE':
      return 'ouioui';
    case 'NON_REPETE':
      return 'nonnon';
    case 'JE_NE_SAIS_PAS':
      return 'je-ne-sais-pas';
    case 'AUTRE':
      return slugify(label);
  }
}

/** Key of a node reached from `parentKey` by a DECISION or SYSTEM edge. A START parent gives a root key. */
export function spineChildKey(parentKey: string | null, answerLabel: string, childLabel: string): string {
  if (parentKey === null) return slugify(childLabel);
  return `${parentKey}[${answerSlug(answerLabel)}]/${slugify(childLabel)}`;
}

export function treeChildKey(parentKey: string, label: string): string {
  return `${parentKey}/${slugify(label)}`;
}

export function characterKey(parentKey: string, clue: string | null, name: string): string {
  const clueSlug = clue === null ? '' : slugify(clue);
  return clueSlug === '' ? `${parentKey}/${slugify(name)}` : `${parentKey}/${clueSlug}--${slugify(name)}`;
}

/** Sibling collision suffix: n = 2 → `key~2`. */
export function collisionKey(key: string, n: number): string {
  return n <= 1 ? key : `${key}~${n}`;
}

/**
 * Salt options for node, edge and character ids (GRAPH_SPECIFICATION.md §7).
 *
 * Unsalted ids are a hash of public information (the slug plus the book path), so a Découvreur
 * could hash a clue together with every known name and recognise a leaf from its id. Real graphs
 * therefore hash `graphSlug + ':' + salt + ':' + key` with a private, constant salt.
 */
export interface IdOptions {
  /** The private `DSA_ID_SALT`. Ignored for the unsalted test graphs. */
  salt?: string | null;
  /** Tests and local checks only: build a real graph without a salt instead of throwing. */
  allowUnsalted?: boolean;
}

/** Graphs whose ids are never salted, so their fixtures stay stable. */
export const UNSALTED_GRAPH_SLUGS: readonly string[] = ['mini'];

export function isUnsaltedGraph(graphSlug: string): boolean {
  return UNSALTED_GRAPH_SLUGS.includes(graphSlug);
}

/** Throws unless the graph may be built with the given salt. Returns the `graphSlug:[salt:]` id prefix. */
export function idPrefix(graphSlug: string, opts: IdOptions = {}): string {
  if (isUnsaltedGraph(graphSlug)) return `${graphSlug}:`;
  const salt = opts.salt ?? '';
  if (salt === '') {
    if (opts.allowUnsalted !== true) {
      throw new Error(
        `graph "${graphSlug}" needs an id salt (DSA_ID_SALT); only ${UNSALTED_GRAPH_SLUGS.join(', ')} may be built unsalted`,
      );
    }
    return `${graphSlug}:`;
  }
  return `${graphSlug}:${salt}:`;
}

/** Same check as `idPrefix`, for callers that only want the guard. */
export function assertIdSalt(graphSlug: string, opts: IdOptions = {}): void {
  idPrefix(graphSlug, opts);
}

export function nodeId(graphSlug: string, nodeKey: string, opts: IdOptions = {}): string {
  return uuidv5(`${idPrefix(graphSlug, opts)}${nodeKey}`, KEY_NAMESPACE);
}

export function edgeId(graphSlug: string, fromKey: string, toKey: string, opts: IdOptions = {}): string {
  return uuidv5(`${idPrefix(graphSlug, opts)}${fromKey}->${toKey}`, KEY_NAMESPACE);
}

/** Not in the spec: graph id = UUID v5 of the slug. Never salted: the slug is public and is how rows are found. */
export function graphId(graphSlug: string): string {
  return uuidv5(graphSlug, KEY_NAMESPACE);
}

/** Not in the spec: character id = UUID v5 of `graphSlug:[salt:]character:<primary node key>`. */
export function characterId(graphSlug: string, primaryNodeKey: string, opts: IdOptions = {}): string {
  return uuidv5(`${idPrefix(graphSlug, opts)}character:${primaryNodeKey}`, KEY_NAMESPACE);
}
