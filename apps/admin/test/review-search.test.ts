import { describe, expect, it } from 'vitest';
import type { ImportBatch } from '../src/lib/graph-repository';
import { buildPageReviews, isPageDone, pageTree } from '../src/lib/review';
import { searchCharacters, searchNodes } from '../src/lib/search';
import { buildTree, subtreeIds, subtreeSize } from '../src/lib/tree';
import { byLabel, miniGraph } from './helpers';

function batch(page: number | null, createdAt: string, status = 'APPLIED'): ImportBatch {
  return { id: `${page}-${createdAt}`, graphSlug: 'mini', source: null, status, page, stats: {}, report: {}, createdAt, appliedAt: null };
}

describe('page review', () => {
  it('counts nodes, edges, characters and statuses per source page', () => {
    const data = miniGraph();
    const reviews = buildPageReviews(data, []);
    expect(reviews.map((r) => r.page)).toEqual([...new Set(data.nodes.map((n) => n.sourcePage).filter((p) => p !== null))].sort((a, b) => a! - b!));
    for (const review of reviews) {
      expect(review.nodes).toBe(data.nodes.filter((n) => n.sourcePage === review.page).length);
      expect(review.edges).toBe(data.edges.filter((e) => e.sourcePage === review.page).length);
      expect(Object.values(review.statuses).reduce((a, b) => a + b, 0)).toBe(review.nodes + review.edges);
      expect(review.rootIds.length).toBeGreaterThan(0);
    }
  });

  it('marks a page with a NEEDS_REVIEW row as not done', () => {
    const data = miniGraph();
    const adam = byLabel(data, 'ADAM');
    adam.reviewStatus = 'NEEDS_REVIEW';
    const review = buildPageReviews(data, []).find((r) => r.page === adam.sourcePage)!;
    expect(review.statuses.NEEDS_REVIEW).toBe(1);
    expect(isPageDone(review)).toBe(false);
  });

  it('attaches the newest import batch of each page', () => {
    const data = miniGraph();
    const page = byLabel(data, 'ADAM').sourcePage!;
    const reviews = buildPageReviews(data, [batch(page, '2026-09-10T00:00:00Z'), batch(page, '2026-09-15T00:00:00Z', 'VALIDATED'), batch(null, '2026-09-16T00:00:00Z')]);
    expect(reviews.find((r) => r.page === page)!.batch!.createdAt).toBe('2026-09-15T00:00:00Z');
  });

  it('lists a page as an indented tree, children in book order', () => {
    const data = miniGraph();
    const page = byLabel(data, 'ADAM').sourcePage!;
    const items = pageTree(data, page);
    expect(items.every((item) => item.node.sourcePage === page)).toBe(true);
    expect(items[0]!.depth).toBe(0);
    const tree = buildTree(data.nodes, data.edges);
    for (let i = 1; i < items.length; i += 1) {
      const item = items[i]!;
      if (item.depth === 0) continue;
      const siblings = (tree.childEdges.get(item.edge!.fromNodeId) ?? []).map((e) => e.toNodeId);
      const later = items.slice(i + 1).filter((other) => other.edge?.fromNodeId === item.edge!.fromNodeId);
      for (const other of later) expect(siblings.indexOf(other.node.id)).toBeGreaterThan(siblings.indexOf(item.node.id));
    }
  });
});

describe('search and tree helpers', () => {
  it('finds nodes by label, clue or key, ignoring accents and case', () => {
    const data = miniGraph();
    expect(searchNodes(data.nodes, 'adam')[0]!.node.label).toBe('ADAM');
    expect(searchNodes(data.nodes, 'premier homme')[0]!.field).toBe('question');
    expect(searchNodes(data.nodes, 'pentateuque[oui]').length).toBeGreaterThan(0);
    expect(searchNodes(data.nodes, '   ')).toEqual([]);
  });

  it('finds characters by name', () => {
    const data = miniGraph();
    expect(searchCharacters(data.characters, 'ada')[0]!.character.name).toBe('ADAM');
  });

  it('measures what a deletion takes with it', () => {
    const data = miniGraph();
    const tree = buildTree(data.nodes, data.edges);
    const section = byLabel(data, 'LIE A ADAM');
    const ids = subtreeIds(tree, section.id, Number.POSITIVE_INFINITY);
    // every node below has exactly one parent edge, plus the edge into the section
    expect(subtreeSize(tree, section.id)).toEqual({ nodes: ids.size, edges: ids.size });
    expect(subtreeIds(tree, tree.rootId!, 0).size).toBe(1);
    expect(subtreeIds(tree, tree.rootId!, Number.POSITIVE_INFINITY).size).toBe(data.nodes.length);
  });
});
