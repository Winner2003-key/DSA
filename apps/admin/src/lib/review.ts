/**
 * Import review, page by page (brief PART 25). The book is reviewed the way it
 * was transcribed: one printed page at a time, against the physical book.
 */
import type { GraphData, GraphEdge, GraphNode, ReviewStatus } from '@dsa/core';
import type { ImportBatch } from './graph-repository';
import { buildTree, compareEdges, type GraphTree } from './tree';

export type StatusCounts = Record<ReviewStatus, number>;

export interface PageReview {
  page: number;
  nodes: number;
  edges: number;
  characters: number;
  /** Nodes and edges of the page together, by review status. */
  statuses: StatusCounts;
  /** The page's topmost nodes: their parent is on another page, or they have none. */
  rootIds: string[];
  /** The most recent import batch for this page, if the importer recorded one. */
  batch: ImportBatch | null;
}

export function emptyCounts(): StatusCounts {
  return { DRAFT: 0, NEEDS_REVIEW: 0, APPROVED: 0, REJECTED: 0 };
}

export function buildPageReviews(data: GraphData, batches: readonly ImportBatch[]): PageReview[] {
  const tree = buildTree(data.nodes, data.edges);
  const pages = new Map<number, PageReview>();
  const pageOf = (page: number): PageReview => {
    let review = pages.get(page);
    if (!review) {
      review = { page, nodes: 0, edges: 0, characters: 0, statuses: emptyCounts(), rootIds: [], batch: null };
      pages.set(page, review);
    }
    return review;
  };

  for (const node of data.nodes) {
    if (node.sourcePage === null) continue;
    const review = pageOf(node.sourcePage);
    review.nodes += 1;
    if (node.nodeType === 'CHARACTER') review.characters += 1;
    review.statuses[node.reviewStatus] += 1;
  }
  for (const edge of data.edges) {
    if (edge.sourcePage === null) continue;
    const review = pageOf(edge.sourcePage);
    review.edges += 1;
    review.statuses[edge.reviewStatus] += 1;
  }
  const order = bookOrder(tree);
  for (const review of pages.values()) review.rootIds = pageRoots(tree, data.nodes, review.page, order).map((node) => node.id);

  // Batches arrive newest first; keep the first one seen per page.
  const newestFirst = [...batches].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  for (const batch of newestFirst) {
    if (batch.page === null) continue;
    const review = pages.get(batch.page);
    if (review && !review.batch) review.batch = batch;
  }

  return [...pages.values()].sort((a, b) => a.page - b.page);
}

/** Nodes of `page` whose parent is not on that page, in the order the game reaches them. */
export function pageRoots(tree: GraphTree, nodes: readonly GraphNode[], page: number, order = bookOrder(tree)): GraphNode[] {
  const roots = nodes.filter((node) => {
    if (node.sourcePage !== page) return false;
    const parent = tree.parentEdges.get(node.id)?.[0];
    return !parent || tree.nodesById.get(parent.fromNodeId)?.sourcePage !== page;
  });
  const rank = (node: GraphNode) => order.get(node.id) ?? Number.MAX_SAFE_INTEGER;
  return roots.sort((a, b) => rank(a) - rank(b) || a.nodeKey.localeCompare(b.nodeKey));
}

/** Depth-first position of every node from the root, children in `order_index` order. */
export function bookOrder(tree: GraphTree): Map<string, number> {
  const order = new Map<string, number>();
  if (!tree.rootId) return order;
  const stack = [tree.rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (order.has(id)) continue;
    order.set(id, order.size);
    const children = tree.childEdges.get(id) ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push((children[i] as GraphEdge).toNodeId);
  }
  return order;
}

export interface PageTreeItem {
  node: GraphNode;
  /** The edge from the parent, when the parent is also shown. */
  edge: GraphEdge | null;
  depth: number;
}

/**
 * A flat, indented listing of the page's nodes: each root followed by its
 * descendants on the same page, children in `order_index` order.
 */
export function pageTree(data: GraphData, page: number): PageTreeItem[] {
  const tree = buildTree(data.nodes, data.edges);
  const items: PageTreeItem[] = [];
  const seen = new Set<string>();
  const walk = (node: GraphNode, edge: GraphEdge | null, depth: number): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    items.push({ node, edge, depth });
    for (const child of [...(tree.childEdges.get(node.id) ?? [])].sort(compareEdges)) {
      const target = tree.nodesById.get(child.toNodeId);
      if (target && target.sourcePage === page) walk(target, child, depth + 1);
    }
  };
  for (const root of pageRoots(tree, data.nodes, page)) walk(root, tree.parentEdges.get(root.id)?.[0] ?? null, 0);
  return items;
}

export function isPageDone(review: PageReview): boolean {
  return review.statuses.NEEDS_REVIEW === 0 && review.statuses.DRAFT === 0 && review.statuses.REJECTED === 0;
}
