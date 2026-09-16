// Page scoping: which rows of a built graph belong to the spine and to each page of the book.

import type { GraphData, GraphEdge, GraphNode } from '@dsa/core';

/**
 * Ids of the nodes that come from `spine.dsa`.
 *
 * The builder only ever creates SYSTEM and DECISION edges for spine lines, and only HIERARCHY
 * edges for page lines, so the spine is exactly the closure from START over non-HIERARCHY edges.
 */
export function spineNodeIds(data: GraphData): Set<string> {
  const out = new Map<string, GraphEdge[]>();
  for (const e of data.edges) {
    if (e.edgeKind === 'HIERARCHY') continue;
    const list = out.get(e.fromNodeId);
    if (list) list.push(e);
    else out.set(e.fromNodeId, [e]);
  }
  const seen = new Set<string>();
  const stack = data.nodes.filter((n) => n.nodeType === 'START').map((n) => n.id);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of out.get(id) ?? []) stack.push(e.toNodeId);
  }
  return seen;
}

export interface Scope {
  /** null = the whole book. Otherwise these pages plus the spine. */
  pages: number[] | null;
  spine: Set<string>;
}

export function makeScope(data: GraphData, pages: number[] | null): Scope {
  return { pages: pages === null ? null : [...new Set(pages)].sort((a, b) => a - b), spine: spineNodeIds(data) };
}

export function nodeInScope(scope: Scope, node: GraphNode): boolean {
  if (scope.pages === null) return true;
  return scope.spine.has(node.id) || (node.sourcePage !== null && scope.pages.includes(node.sourcePage));
}

export function edgeInScope(scope: Scope, edge: GraphEdge): boolean {
  if (scope.pages === null) return true;
  // A spine edge joins two spine nodes; the edge that attaches page content carries that page.
  if (scope.spine.has(edge.fromNodeId) && scope.spine.has(edge.toNodeId)) return true;
  return edge.sourcePage !== null && scope.pages.includes(edge.sourcePage);
}

/** The sub-graph the importer will write: the spine plus the selected pages. */
export function selectScope(data: GraphData, scope: Scope): GraphData {
  if (scope.pages === null) return data;
  const nodes = data.nodes.filter((n) => nodeInScope(scope, n));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => edgeInScope(scope, e) && nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId));
  const wanted = new Set(nodes.map((n) => n.characterId).filter((id): id is string => id !== null));
  const characters = data.characters.filter((c) => wanted.has(c.id));
  return { graph: data.graph, nodes, edges, characters };
}

/**
 * Edges of the selection whose endpoints are outside it. With `--pages`, they can only be written
 * once the page holding the missing node has been imported too.
 */
export function danglingEdges(data: GraphData, scope: Scope): { edge: GraphEdge; missing: string[] }[] {
  if (scope.pages === null) return [];
  const keyOf = new Map(data.nodes.map((n) => [n.id, n.nodeKey]));
  const inside = new Set(data.nodes.filter((n) => nodeInScope(scope, n)).map((n) => n.id));
  const out: { edge: GraphEdge; missing: string[] }[] = [];
  for (const e of data.edges) {
    if (!edgeInScope(scope, e)) continue;
    const missing = [e.fromNodeId, e.toNodeId].filter((id) => !inside.has(id)).map((id) => keyOf.get(id) ?? id);
    if (missing.length > 0) out.push({ edge: e, missing });
  }
  return out;
}

export interface PageStats {
  /** `spine`, a page number, or `null` for rows with no page at all. */
  label: string;
  page: number | null;
  isSpine: boolean;
  nodes: number;
  edges: number;
  characters: number;
  needsReviewNodes: number;
  needsReviewEdges: number;
}

/** One row per source: the spine first, then every page in book order. */
export function pageStats(data: GraphData, spine: Set<string> = spineNodeIds(data)): PageStats[] {
  const rows = new Map<string, PageStats>();
  const row = (isSpine: boolean, page: number | null): PageStats => {
    const label = isSpine ? 'spine' : page === null ? '—' : String(page);
    let r = rows.get(label);
    if (!r) {
      r = { label, page, isSpine, nodes: 0, edges: 0, characters: 0, needsReviewNodes: 0, needsReviewEdges: 0 };
      rows.set(label, r);
    }
    return r;
  };
  const charactersPerRow = new Map<string, Set<string>>();
  for (const n of data.nodes) {
    const isSpine = spine.has(n.id);
    const r = row(isSpine, isSpine ? null : n.sourcePage);
    r.nodes++;
    if (n.reviewStatus === 'NEEDS_REVIEW') r.needsReviewNodes++;
    if (n.characterId !== null) {
      const set = charactersPerRow.get(r.label) ?? new Set<string>();
      set.add(n.characterId);
      charactersPerRow.set(r.label, set);
    }
  }
  for (const e of data.edges) {
    const isSpine = spine.has(e.fromNodeId) && spine.has(e.toNodeId);
    const r = row(isSpine, isSpine ? null : e.sourcePage);
    r.edges++;
    if (e.reviewStatus === 'NEEDS_REVIEW') r.needsReviewEdges++;
  }
  for (const [label, set] of charactersPerRow) {
    const r = rows.get(label);
    if (r) r.characters = set.size;
  }
  return [...rows.values()].sort((a, b) => {
    if (a.isSpine !== b.isSpine) return a.isSpine ? -1 : 1;
    return (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER);
  });
}
