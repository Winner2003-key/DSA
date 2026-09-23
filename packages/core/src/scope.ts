// Practising one part of the book (GRAPH_SPECIFICATION.md §2, "scope").
//
// A scope is a set of section node ids. It restricts **only which name is
// drawn**: the questions still start at the beginning, so the pair keeps
// learning the whole path down to that part of the book.
//
// The SQL mirror is dsa_list_sections / dsa_scope_characters / dsa_normalize_settings.

import type { GraphIndex } from './graph-index';
import type { GraphEdge, GraphNode } from './types';

/** A node of the picker's tree: every playable non-CHARACTER node of the graph. */
export interface Section {
  nodeId: string;
  label: string;
  /** The section above it, or null for the root. */
  parentId: string | null;
  /** Distance from START (the root is 0). */
  depth: number;
  /** How many playable names are underneath it. */
  characters: number;
}

/** Walks the graph from START, deepest-last, in book order. */
function walk(ix: GraphIndex, visit: (node: GraphNode, parentId: string | null, depth: number) => void): void {
  const start = ix.start();
  const seen = new Set<string>();
  const stack: { id: string; parentId: string | null; depth: number }[] = [{ id: start.id, parentId: null, depth: 0 }];
  while (stack.length > 0) {
    const { id, parentId, depth } = stack.pop() as { id: string; parentId: string | null; depth: number };
    if (seen.has(id)) continue;
    seen.add(id);
    const node = ix.node(id);
    if (!node) continue;
    visit(node, parentId, depth);
    const children = ix.outgoing(id);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: (children[i] as GraphEdge).toNodeId, parentId: id, depth: depth + 1 });
    }
  }
}

/**
 * The sections a player may practise, in book order: every approved
 * non-CHARACTER node reachable from START, with the number of playable names
 * underneath. **Never a name, a clue or a leaf** — a picker built from this
 * reveals no more than the book's table of contents.
 */
export function listSections(ix: GraphIndex): Section[] {
  const parentOf = new Map<string, string | null>();
  const depthOf = new Map<string, number>();
  const order: GraphNode[] = [];
  walk(ix, (node, parentId, depth) => {
    parentOf.set(node.id, parentId);
    depthOf.set(node.id, depth);
    order.push(node);
  });

  // Count the names underneath by walking each leaf up to the root once.
  const counts = new Map<string, number>();
  for (const node of order) {
    if (node.nodeType !== 'CHARACTER') continue;
    let current = parentOf.get(node.id) ?? null;
    const seen = new Set<string>();
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      counts.set(current, (counts.get(current) ?? 0) + 1);
      current = parentOf.get(current) ?? null;
    }
  }

  return order
    .filter((n) => n.nodeType !== 'CHARACTER')
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      parentId: parentOf.get(n.id) ?? null,
      depth: depthOf.get(n.id) ?? 0,
      characters: counts.get(n.id) ?? 0,
    }));
}

/** Section ids that a scope may name: the same set `listSections` describes. */
export function sectionIds(ix: GraphIndex): Set<string> {
  return new Set(listSections(ix).map((s) => s.nodeId));
}

/**
 * The playable names a scope allows, in book order and without duplicates.
 * An empty (or absent) scope is the whole book.
 */
export function scopeCharacters(ix: GraphIndex, scope: readonly string[] | null | undefined): GraphNode[] {
  const all = ix.playableCharacters();
  if (!scope || scope.length === 0) return all;
  const wanted = new Set(scope);
  return all.filter((c) => {
    for (const sectionId of wanted) {
      if (ix.isAncestorOrSelf(sectionId, c.id)) return true;
    }
    return false;
  });
}

export type ScopeProblem =
  | { code: 'INVALID_SETTINGS'; message: string }
  | { code: 'NO_PLAYABLE_SECRET'; message: string };

/**
 * Checks a scope against the graph: every id must be a playable section of it,
 * and the union must hold at least one name. null when the scope is fine.
 */
export function checkScope(ix: GraphIndex, scope: readonly string[] | null | undefined): ScopeProblem | null {
  if (!scope || scope.length === 0) return null;
  const known = sectionIds(ix);
  const unknown = scope.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return { code: 'INVALID_SETTINGS', message: `scope has unknown section(s): ${unknown.join(', ')}` };
  }
  if (scopeCharacters(ix, scope).length === 0) {
    return { code: 'NO_PLAYABLE_SECRET', message: 'the chosen part of the book has no playable name' };
  }
  return null;
}

/** A scope as it is stored: sorted, without duplicates, empty for the whole book. */
export function normalizeScope(scope: readonly string[] | null | undefined): string[] {
  if (!scope) return [];
  return [...new Set(scope)].sort();
}

/** The labels of the chosen sections, in book order — what the game screen shows. */
export function scopeLabels(ix: GraphIndex, scope: readonly string[] | null | undefined): string[] {
  if (!scope || scope.length === 0) return [];
  const wanted = new Set(scope);
  return listSections(ix)
    .filter((s) => wanted.has(s.nodeId))
    .map((s) => s.label);
}
