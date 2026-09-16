/**
 * The editor's search: nodes by label, clue or key, and characters by name,
 * alias or description. Accent- and case-insensitive, because nobody types
 * "NÉS À HÉBRON" with its accents into a search box.
 */
import { normalizeText, type BibleCharacter, type GraphNode } from '@dsa/core';

export interface NodeHit {
  kind: 'node';
  node: GraphNode;
  /** Which field matched, for the result list. */
  field: 'label' | 'question' | 'nodeKey' | 'description';
  score: number;
}

export interface CharacterHit {
  kind: 'character';
  character: BibleCharacter;
  field: 'name' | 'alias' | 'description';
  score: number;
}

export type SearchHit = NodeHit | CharacterHit;

/** 3 = exact, 2 = prefix, 1 = substring, 0 = no match. */
function score(haystack: string | null, needle: string): number {
  if (!haystack) return 0;
  const value = normalizeText(haystack);
  if (value === needle) return 3;
  if (value.startsWith(needle)) return 2;
  return value.includes(needle) ? 1 : 0;
}

function best<T extends string>(candidates: [T, string | null][], needle: string): { field: T; score: number } | null {
  let found: { field: T; score: number } | null = null;
  for (const [field, value] of candidates) {
    const s = score(value, needle);
    if (s > 0 && (!found || s > found.score)) found = { field, score: s };
  }
  return found;
}

export function searchNodes(nodes: readonly GraphNode[], term: string, limit = 40): NodeHit[] {
  const needle = normalizeText(term.trim());
  if (needle.length === 0) return [];
  const hits: NodeHit[] = [];
  for (const node of nodes) {
    const found = best<NodeHit['field']>(
      [
        ['label', node.label],
        ['question', node.question],
        ['description', node.description],
        ['nodeKey', node.nodeKey],
      ],
      needle,
    );
    if (found) hits.push({ kind: 'node', node, field: found.field, score: found.score });
  }
  return rank(hits, limit);
}

export function searchCharacters(characters: readonly BibleCharacter[], term: string, limit = 40): CharacterHit[] {
  const needle = normalizeText(term.trim());
  if (needle.length === 0) return [];
  const hits: CharacterHit[] = [];
  for (const character of characters) {
    const aliasScore = Math.max(0, ...character.aliases.map((alias) => score(alias, needle)));
    const found = best<CharacterHit['field']>(
      [
        ['name', character.name],
        ['description', character.description],
      ],
      needle,
    );
    const nameScore = found?.score ?? 0;
    if (aliasScore > nameScore) hits.push({ kind: 'character', character, field: 'alias', score: aliasScore });
    else if (found) hits.push({ kind: 'character', character, field: found.field, score: found.score });
  }
  return rank(hits, limit);
}

function rank<T extends SearchHit>(hits: T[], limit: number): T[] {
  return hits
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aKey = a.kind === 'node' ? a.node.label : a.character.name;
      const bKey = b.kind === 'node' ? b.node.label : b.character.name;
      return aKey.localeCompare(bKey, 'fr');
    })
    .slice(0, limit);
}
