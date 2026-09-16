/**
 * Automatic layout for the canvas. The default is a tidy top-down tree that
 * reads like the book: one level per row, siblings left to right in
 * `order_index` order. Dagre is offered as a second pass for graphs that are
 * not a clean tree (a node with several parents, say), because a tidy tree has
 * to pick one parent and the result can cross edges.
 */
import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from '@dsa/core';
import { buildTree, compareEdges, type GraphTree } from './tree';

export interface XY {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Horizontal distance between two sibling leaves, centre to centre. */
  columnWidth?: number;
  /** Vertical distance between two levels, centre to centre. */
  rowHeight?: number;
}

const DEFAULTS = { columnWidth: 268, rowHeight: 148 };

export const NODE_WIDTH = 236;
export const NODE_HEIGHT = 76;

/**
 * Tidy tree: every leaf gets the next free column, every parent is centred over
 * its children. Nodes that are not reachable from a root are laid out under
 * their own root afterwards, so nothing is dropped or stacked at the origin.
 */
export function layoutTree(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: LayoutOptions = {},
): Map<string, XY> {
  const { columnWidth, rowHeight } = { ...DEFAULTS, ...options };
  const tree = buildTree(nodes, edges);
  const positions = new Map<string, XY>();
  const placed = new Set<string>();
  let cursor = 0;

  const place = (id: string, depth: number, path: Set<string>): number => {
    // A cycle would otherwise recurse forever; the second visit just reuses the
    // column already assigned to the node.
    if (path.has(id) || placed.has(id)) return positions.get(id)?.x ?? cursor * columnWidth;
    placed.add(id);
    const nextPath = new Set(path).add(id);
    const children = (tree.childEdges.get(id) ?? []).filter((edge) => !path.has(edge.toNodeId) && !placed.has(edge.toNodeId));
    let x: number;
    if (children.length === 0) {
      x = cursor * columnWidth;
      cursor += 1;
    } else {
      const childXs = children.map((edge) => place(edge.toNodeId, depth + 1, nextPath));
      const first = childXs[0] ?? 0;
      const last = childXs[childXs.length - 1] ?? first;
      x = (first + last) / 2;
    }
    positions.set(id, { x, y: depth * rowHeight });
    return x;
  };

  const roots = rootOrder(nodes, tree);
  for (const root of roots) {
    if (!placed.has(root.id)) place(root.id, 0, new Set());
  }
  // Anything left is inside a cycle with no entry point.
  for (const node of nodes) {
    if (!placed.has(node.id)) place(node.id, 0, new Set());
  }
  return positions;
}

/** START first, then the remaining parentless nodes, then everything else. */
function rootOrder(nodes: readonly GraphNode[], tree: GraphTree): GraphNode[] {
  const parentless = nodes.filter((n) => (tree.parentEdges.get(n.id)?.length ?? 0) === 0);
  return [...parentless].sort((a, b) => {
    if (a.nodeType === 'START' && b.nodeType !== 'START') return -1;
    if (b.nodeType === 'START' && a.nodeType !== 'START') return 1;
    return a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0;
  });
}

/** Dagre's layered layout, with siblings fed in `order_index` order. */
export function layoutDagre(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: LayoutOptions = {},
): Map<string, XY> {
  const { columnWidth, rowHeight } = { ...DEFAULTS, ...options };
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: columnWidth - NODE_WIDTH, ranksep: rowHeight - NODE_HEIGHT, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  const known = new Set(nodes.map((n) => n.id));
  for (const edge of [...edges].sort(compareEdges)) {
    if (known.has(edge.fromNodeId) && known.has(edge.toNodeId)) g.setEdge(edge.fromNodeId, edge.toNodeId);
  }
  dagre.layout(g);
  const positions = new Map<string, XY>();
  for (const node of nodes) {
    const laid = g.node(node.id) as { x: number; y: number } | undefined;
    if (laid) positions.set(node.id, { x: laid.x - NODE_WIDTH / 2, y: laid.y - NODE_HEIGHT / 2 });
  }
  return positions;
}

/**
 * The position React Flow should use: the saved `position_x/y` when the node
 * has one, otherwise the computed fallback. Keeps hand-placed nodes where the
 * admin put them while new or never-laid-out nodes still land somewhere sane.
 */
export function resolvePosition(node: GraphNode, fallback: Map<string, XY>): XY {
  if (node.positionX !== null && node.positionY !== null) return { x: node.positionX, y: node.positionY };
  return fallback.get(node.id) ?? { x: 0, y: 0 };
}
