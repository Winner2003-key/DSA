import { describe, expect, it } from 'vitest';
import { danglingEdges, makeScope, pageStats, selectScope, spineNodeIds } from '../src/select';
import { buildFixture } from './fixtures';

const book = buildFixture();
const keyOf = (id: string) => book.data.nodes.find((n) => n.id === id)?.nodeKey;

describe('spineNodeIds', () => {
  it('is exactly what spine.dsa declares', () => {
    const spine = spineNodeIds(book.data);
    expect([...spine].map(keyOf).sort()).toEqual(['ancien', 'ancien[non]/section-b', 'ancien[oui]/section-a', 'dsa']);
  });
});

describe('selectScope', () => {
  it('keeps everything when no page is given', () => {
    expect(selectScope(book.data, makeScope(book.data, null))).toBe(book.data);
  });

  it('keeps the spine plus the selected page, with its characters', () => {
    const selected = selectScope(book.data, makeScope(book.data, [1]));
    expect(selected.nodes.map((n) => n.nodeKey)).toEqual([
      'dsa',
      'ancien',
      'ancien[oui]/section-a',
      'ancien[oui]/section-a/classe-un',
      'ancien[oui]/section-a/classe-un/le-premier--alpha',
      'ancien[oui]/section-a/classe-un/le-second--beta',
      'ancien[non]/section-b',
    ]);
    expect(selected.characters.map((c) => c.name).sort()).toEqual(['ALPHA', 'BETA']);
    const ids = new Set(selected.nodes.map((n) => n.id));
    expect(selected.edges.every((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId))).toBe(true);
  });

  it('reports nothing dangling for a page whose parent is in the spine', () => {
    expect(danglingEdges(book.data, makeScope(book.data, [1]))).toEqual([]);
  });

  it('reports an edge whose parent page was left out', () => {
    const deep = buildFixture({
      page1: '@page 1\n@attach ancien[oui]/section-a\n\nCLASSE UN {classe}\n  Le premier • ALPHA\n',
      page2: '@page 2\n@attach ancien[oui]/section-a/classe-un\n\nSOUS GROUPE\n  Le second • BETA\n',
    });
    const dangling = danglingEdges(deep.data, makeScope(deep.data, [2]));
    expect(dangling.length).toBe(1);
    expect(dangling[0]?.missing).toEqual(['ancien[oui]/section-a/classe-un']);
    expect(danglingEdges(deep.data, makeScope(deep.data, [1, 2]))).toEqual([]);
  });
});

describe('pageStats', () => {
  it('counts nodes, edges, characters and NEEDS_REVIEW per source', () => {
    const rows = pageStats(book.data);
    expect(rows.map((r) => r.label)).toEqual(['spine', '1', '2']);
    expect(rows[0]).toMatchObject({ isSpine: true, nodes: 4, edges: 3, characters: 0 });
    expect(rows[1]).toMatchObject({ page: 1, nodes: 3, edges: 3, characters: 2 });
    expect(rows[2]).toMatchObject({ page: 2, nodes: 2, edges: 2, characters: 1, needsReviewNodes: 2 });
    expect(rows.reduce((n, r) => n + r.nodes, 0)).toBe(book.data.nodes.length);
    expect(rows.reduce((n, r) => n + r.edges, 0)).toBe(book.data.edges.length);
  });
});
