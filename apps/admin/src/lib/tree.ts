/**
 * Tree navigation over a GraphData that is still being edited, so it cannot use
 * `GraphIndex` (which hides everything that is not APPROVED). Children are kept
 * in book order: `order_index` first, then `id`, exactly like the database
 * index `(from_node_id, order_index)` and DATABASE_SCHEMA.md ("ties are broken
 * by `id`").
 */
import type { GraphEdge, GraphNode } from '@dsa/core';

export interface GraphTree {
  nodesById: Map<string, GraphNode>;
  edgesById: Map<string, GraphEdge>;
  /** Outgoing edges per node, in book order. */
  childEdges: Map<string, GraphEdge[]>;
  /** Incoming edges per node, in book order. */
  parentEdges: Map<string, GraphEdge[]>;
  /** START if there is one, otherwise the first node without a parent. */
  rootId: string | null;
}

export function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return a.orderIndex - b.orderIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function buildTree(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphTree {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const childEdges = new Map<string, GraphEdge[]>();
  const parentEdges = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (!nodesById.has(edge.fromNodeId) || !nodesById.has(edge.toNodeId)) continue;
    push(childEdges, edge.fromNodeId, edge);
    push(parentEdges, edge.toNodeId, edge);
  }
  for (const list of childEdges.values()) list.sort(compareEdges);
  for (const list of parentEdges.values()) list.sort(compareEdges);

  const start = nodes.find((n) => n.nodeType === 'START');
  const orphan = nodes.find((n) => (parentEdges.get(n.id)?.length ?? 0) === 0);
  return { nodesById, edgesById, childEdges, parentEdges, rootId: start?.id ?? orphan?.id ?? null };
}

function push<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function childrenOf(tree: GraphTree, nodeId: string): GraphNode[] {
  return (tree.childEdges.get(nodeId) ?? [])
    .map((edge) => tree.nodesById.get(edge.toNodeId))
    .filter((n): n is GraphNode => n !== undefined);
}

export function parentOf(tree: GraphTree, nodeId: string): GraphNode | null {
  const edge = tree.parentEdges.get(nodeId)?.[0];
  return edge ? (tree.nodesById.get(edge.fromNodeId) ?? null) : null;
}

/** The node and its ancestors, root first. Stops on a cycle. */
export function ancestorChain(tree: GraphTree, nodeId: string): GraphNode[] {
  const chain: GraphNode[] = [];
  const seen = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = tree.nodesById.get(current);
    if (!node) break;
    chain.unshift(node);
    current = tree.parentEdges.get(current)?.[0]?.fromNodeId ?? null;
  }
  return chain;
}

/**
 * Ids of `rootId` and its descendants, down to `depth` levels of children
 * (`depth = 0` is the node alone). `depth = Infinity` takes the whole subtree.
 */
export function subtreeIds(tree: GraphTree, rootId: string, depth: number): Set<string> {
  const ids = new Set<string>();
  const walk = (id: string, remaining: number): void => {
    if (ids.has(id) || !tree.nodesById.has(id)) return;
    ids.add(id);
    if (remaining <= 0) return;
    for (const edge of tree.childEdges.get(id) ?? []) walk(edge.toNodeId, remaining - 1);
  };
  walk(rootId, depth);
  return ids;
}

export interface SubtreeSize {
  nodes: number;
  edges: number;
}

/** What deleting `nodeId` takes with it: the node, its descendants, and every incident edge. */
export function subtreeSize(tree: GraphTree, nodeId: string): SubtreeSize {
  const ids = subtreeIds(tree, nodeId, Number.POSITIVE_INFINITY);
  const edges = new Set<string>();
  for (const id of ids) {
    for (const edge of tree.childEdges.get(id) ?? []) edges.add(edge.id);
    for (const edge of tree.parentEdges.get(id) ?? []) edges.add(edge.id);
  }
  return { nodes: ids.size, edges: edges.size };
}

/** The edge kind a new edge leaving `from` should have (GRAPH_SPECIFICATION §2). */
export function edgeKindFor(from: GraphNode): GraphEdge['edgeKind'] {
  if (from.nodeType === 'START') return 'SYSTEM';
  if (from.nodeType === 'QUESTION') return 'DECISION';
  return 'HIERARCHY';
}

/** The default answer label for a new edge of that kind, as printed in the book. */
export function defaultAnswerLabel(kind: GraphEdge['edgeKind']): string {
  return kind === 'SYSTEM' ? 'DÉBUT' : 'OUI';
}
