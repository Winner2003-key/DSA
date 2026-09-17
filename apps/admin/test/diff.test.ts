import { describe, expect, it } from 'vitest';
import { computeDiff, describeDiff, isEmptyDiff, isPositionOnly, summarize } from '../src/lib/diff';
import { byLabel, miniGraph } from './helpers';

describe('computeDiff', () => {
  it('finds nothing between two copies of the same graph, whatever the metadata key order', () => {
    const before = miniGraph();
    const after = miniGraph();
    const n = after.nodes.find((x) => Object.keys(x.metadata).length > 0)!;
    n.metadata = Object.fromEntries(Object.entries(n.metadata).reverse());
    expect(isEmptyDiff(computeDiff(before, after))).toBe(true);
  });

  it('reports added nodes and edges', () => {
    const before = miniGraph();
    const after = miniGraph();
    const parent = byLabel(after, 'LIE A ADAM');
    after.nodes.push({ ...parent, id: 'new-node', nodeKey: `${parent.nodeKey}/nouveau`, label: 'NOUVEAU', metadata: { origin: 'admin' } });
    after.edges.push({ ...after.edges[1]!, id: 'new-edge', fromNodeId: parent.id, toNodeId: 'new-node', orderIndex: 9 });
    const diff = computeDiff(before, after);
    expect(diff.nodes.created.map((n) => n.id)).toEqual(['new-node']);
    expect(diff.edges.created.map((e) => e.id)).toEqual(['new-edge']);
    expect(summarize(diff)).toMatchObject({ nodesCreated: 1, edgesCreated: 1, total: 2 });
  });

  it('reports updated fields by name', () => {
    const before = miniGraph();
    const after = miniGraph();
    const adam = byLabel(after, 'ADAM');
    adam.reviewStatus = 'REJECTED';
    adam.reviewNote = 'Mauvais indice';
    const diff = computeDiff(before, after);
    expect(diff.nodes.updated).toHaveLength(1);
    expect(diff.nodes.updated[0]!.changed).toEqual(['reviewNote', 'reviewStatus']);
    expect(isPositionOnly(diff.nodes.updated[0]!)).toBe(false);
  });

  it('reports deleted rows', () => {
    const before = miniGraph();
    const after = miniGraph();
    const adam = byLabel(after, 'ADAM');
    after.nodes = after.nodes.filter((n) => n.id !== adam.id);
    after.edges = after.edges.filter((e) => e.toNodeId !== adam.id);
    const diff = computeDiff(before, after);
    expect(diff.nodes.deleted.map((n) => n.label)).toEqual(['ADAM']);
    expect(diff.edges.deleted).toHaveLength(1);
    expect(summarize(diff)).toMatchObject({ nodesDeleted: 1, edgesDeleted: 1 });
  });

  it('counts a sibling swap as reordered edges', () => {
    const before = miniGraph();
    const after = miniGraph();
    const parentId = after.edges.find((e) => after.edges.filter((x) => x.fromNodeId === e.fromNodeId).length >= 2)!.fromNodeId;
    const [first, second] = after.edges.filter((e) => e.fromNodeId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    const firstIndex = first!.orderIndex;
    first!.orderIndex = second!.orderIndex;
    second!.orderIndex = firstIndex;
    const summary = summarize(computeDiff(before, after));
    expect(summary.edgesUpdated).toBe(2);
    expect(summary.edgesReordered).toBe(2);
    expect(describeDiff(summary)).toEqual(['2 arêtes modifiées (dont 2 réordonnées)']);
  });

  it('separates a position-only change from a real edit', () => {
    const before = miniGraph();
    const after = miniGraph();
    const adam = byLabel(after, 'ADAM');
    adam.positionX = 120;
    adam.positionY = 480;
    const diff = computeDiff(before, after);
    expect(isPositionOnly(diff.nodes.updated[0]!)).toBe(true);
    const summary = summarize(diff);
    expect(summary).toMatchObject({ nodesMoved: 1, nodesUpdated: 0, total: 1 });
    expect(describeDiff(summary)).toEqual(['1 nœud déplacé']);
  });

  it('reports created characters', () => {
    const before = miniGraph();
    const after = miniGraph();
    after.characters.push({ ...after.characters[0]!, id: 'c-new', name: 'NOUVEAU' });
    expect(summarize(computeDiff(before, after))).toMatchObject({ charactersCreated: 1 });
  });
});
