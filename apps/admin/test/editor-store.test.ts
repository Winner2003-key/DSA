import { beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, draftSummary, uniqueKey, useEditorStore } from '../src/store/editor-store';
import { byLabel, miniGraph } from './helpers';

const store = () => useEditorStore.getState();

describe('editor store: undo / redo', () => {
  beforeEach(() => store().load(miniGraph()));

  it('undoes and redoes an edit', () => {
    const adam = byLabel(miniGraph(), 'ADAM');
    store().updateNode(adam.id, { label: 'ADAM (corrigé)' });
    expect(byLabel(store().present!, 'ADAM (corrigé)').id).toBe(adam.id);

    store().undo();
    expect(byLabel(store().present!, 'ADAM').id).toBe(adam.id);
    expect(store().future).toHaveLength(1);

    store().redo();
    expect(byLabel(store().present!, 'ADAM (corrigé)').id).toBe(adam.id);
    expect(store().past).toHaveLength(1);
  });

  it('merges consecutive keystrokes that share a merge key into one step', () => {
    const adam = byLabel(miniGraph(), 'ADAM');
    for (const label of ['A', 'AD', 'ADA', 'ADAMO']) store().updateNode(adam.id, { label }, `label:${adam.id}`);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(byLabel(store().present!, 'ADAM').id).toBe(adam.id);
  });

  it('merges a whole drag into one step', () => {
    const adam = byLabel(miniGraph(), 'ADAM');
    store().moveNode(adam.id, { x: 1, y: 1 });
    store().moveNode(adam.id, { x: 50, y: 60.123 });
    expect(store().past).toHaveLength(1);
    const moved = store().present!.nodes.find((n) => n.id === adam.id)!;
    expect([moved.positionX, moved.positionY]).toEqual([50, 60.12]);
    expect(draftSummary(store().baseline, store().present)).toMatchObject({ nodesMoved: 1, total: 1 });
  });

  it('clears the redo stack after a new edit', () => {
    const adam = byLabel(miniGraph(), 'ADAM');
    store().updateNode(adam.id, { reviewStatus: 'REJECTED' });
    store().undo();
    store().updateNode(adam.id, { reviewNote: 'autre chose' });
    expect(store().future).toHaveLength(0);
    store().redo();
    expect(store().present!.nodes.find((n) => n.id === adam.id)!.reviewNote).toBe('autre chose');
  });

  it('does nothing when there is nothing to undo or redo', () => {
    const before = store().present;
    store().undo();
    store().redo();
    expect(store().present).toBe(before);
  });

  it('caps the history', () => {
    const adam = byLabel(miniGraph(), 'ADAM');
    for (let i = 0; i < HISTORY_LIMIT + 15; i += 1) store().updateNode(adam.id, { reviewNote: `note ${i}` });
    expect(store().past).toHaveLength(HISTORY_LIMIT);
  });

  it('undoes a subtree deletion in one step', () => {
    const section = byLabel(miniGraph(), 'LIE A ADAM');
    const nodes = store().present!.nodes.length;
    const edges = store().present!.edges.length;
    store().deleteNode(section.id);
    expect(store().present!.nodes.length).toBeLessThan(nodes - 1);
    store().undo();
    expect(store().present!.nodes).toHaveLength(nodes);
    expect(store().present!.edges).toHaveLength(edges);
  });
});

describe('editor store: structural edits', () => {
  beforeEach(() => store().load(miniGraph()));

  it('appends a child at the end, tagged as admin work with a random id', () => {
    const section = byLabel(miniGraph(), 'LIE A ADAM');
    const siblings = store().present!.edges.filter((e) => e.fromNodeId === section.id).length;
    const id = store().addChild(section.id, { nodeType: 'CHARACTER', label: 'SETH', question: 'Le remplaçant' })!;
    const created = store().present!.nodes.find((n) => n.id === id)!;
    const link = store().present!.edges.find((e) => e.toNodeId === id)!;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(created.metadata.origin).toBe('admin');
    expect(link.metadata.origin).toBe('admin');
    expect(link.orderIndex).toBe(siblings);
    expect(link.edgeKind).toBe('HIERARCHY');
    expect(created.nodeKey).toBe(`${section.nodeKey}/le-remplacant--seth`);
    expect(store().selection).toEqual({ kind: 'node', id });
  });

  it('chooses the edge kind from the source node type', () => {
    const data = miniGraph();
    const question = data.nodes.find((n) => n.nodeType === 'QUESTION')!;
    const character = data.nodes.find((n) => n.nodeType === 'CHARACTER' && n.label === 'ADAM')!;
    const id = store().connect(question.id, character.id)!;
    expect(store().present!.edges.find((e) => e.id === id)!.edgeKind).toBe('DECISION');
    expect(store().connect(question.id, character.id)).toBeNull();
  });

  it('reorders siblings and keeps them numbered 0..n-1', () => {
    const data = miniGraph();
    const parentId = data.edges.find((e) => data.edges.filter((x) => x.fromNodeId === e.fromNodeId).length >= 3)!.fromNodeId;
    const order = () =>
      store()
        .present!.edges.filter((e) => e.fromNodeId === parentId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((e) => e.id);
    const [first, second, ...rest] = order();
    store().reorderEdge(second!, -1);
    expect(order()).toEqual([second, first, ...rest]);
    expect(store().present!.edges.filter((e) => e.fromNodeId === parentId).map((e) => e.orderIndex).sort()).toEqual(
      [...Array(rest.length + 2).keys()],
    );
    store().reorderEdge(second!, -1); // already first: no-op
    expect(order()).toEqual([second, first, ...rest]);
  });

  it('closes the order gap when an edge is deleted', () => {
    const data = miniGraph();
    const parentId = data.edges.find((e) => data.edges.filter((x) => x.fromNodeId === e.fromNodeId).length >= 3)!.fromNodeId;
    const first = data.edges.filter((e) => e.fromNodeId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)[0]!;
    store().deleteEdge(first.id);
    const indexes = store().present!.edges.filter((e) => e.fromNodeId === parentId).map((e) => e.orderIndex).sort();
    expect(indexes).toEqual([...Array(indexes.length).keys()]);
  });

  it('suffixes a colliding node key with ~2', () => {
    const data = miniGraph();
    const adam = byLabel(data, 'ADAM');
    const parent = data.nodes.find((n) => data.edges.some((e) => e.fromNodeId === n.id && e.toNodeId === adam.id))!;
    expect(uniqueKey(data.nodes, parent, 'CHARACTER', 'ADAM', 'Premier homme', 'OUI')).toBe(`${adam.nodeKey}~2`);
  });
});

describe('editor store: positions', () => {
  beforeEach(() => store().load(miniGraph()));

  it('clears hand-placed positions in one undoable step, and skips untouched cards', () => {
    const adam = byLabel(miniGraph(), 'ADAM');
    store().moveNode(adam.id, { x: 10, y: 20 });
    const steps = store().past.length;
    store().clearPositions([adam.id]);
    expect(store().present!.nodes.find((n) => n.id === adam.id)!.positionX).toBeNull();
    expect(store().past.length).toBe(steps + 1);
    store().clearPositions([adam.id]); // nothing left to clear: no history entry
    expect(store().past.length).toBe(steps + 1);
    store().undo();
    expect(store().present!.nodes.find((n) => n.id === adam.id)!.positionX).toBe(10);
  });
});
