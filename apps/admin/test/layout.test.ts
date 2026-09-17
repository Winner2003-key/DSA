import { describe, expect, it } from 'vitest';
import { layoutDagre, layoutTree, resolvePosition } from '../src/lib/layout';
import { edge, miniGraph, node } from './helpers';

describe('tree layout', () => {
  const nodes = [node('root', { nodeType: 'START' }), node('a'), node('b'), node('c'), node('b1'), node('b2')];

  it('places siblings left to right in order_index order, not array or alphabetical order', () => {
    // Edges deliberately listed out of order.
    const edges = [edge('root', 'c', 0), edge('root', 'a', 2), edge('root', 'b', 1), edge('b', 'b2', 0), edge('b', 'b1', 1)];
    const at = layoutTree(nodes, edges);
    const x = (id: string) => at.get(id)!.x;
    expect(x('c')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('a'));
    expect(x('b2')).toBeLessThan(x('b1'));
  });

  it('puts one level per row and centres a parent over its children', () => {
    const edges = [edge('root', 'a', 0), edge('root', 'b', 1), edge('root', 'c', 2), edge('b', 'b1', 0), edge('b', 'b2', 1)];
    const at = layoutTree(nodes, edges, { rowHeight: 100, columnWidth: 50 });
    expect(at.get('root')!.y).toBe(0);
    expect(at.get('a')!.y).toBe(100);
    expect(at.get('b1')!.y).toBe(200);
    expect(at.get('b')!.x).toBe((at.get('b1')!.x + at.get('b2')!.x) / 2);
    const xs = [...at.values()].filter((p) => p.y === 200).map((p) => p.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('breaks order_index ties by edge id, like the database index', () => {
    const edges = [edge('root', 'b', 0, { id: 'z' }), edge('root', 'a', 0, { id: 'y' })];
    const at = layoutTree(nodes.slice(0, 3), edges);
    expect(at.get('a')!.x).toBeLessThan(at.get('b')!.x);
  });

  it('lays out every node of the mini graph, even with a cycle', () => {
    const data = miniGraph();
    expect(layoutTree(data.nodes, data.edges).size).toBe(data.nodes.length);
    const cyclic = [edge('a', 'b', 0), edge('b', 'a', 0)];
    expect(layoutTree([node('a'), node('b')], cyclic).size).toBe(2);
  });

  it('keeps a saved position over the computed one', () => {
    const fallback = new Map([['a', { x: 1, y: 2 }]]);
    expect(resolvePosition(node('a', { positionX: 30, positionY: 40 }), fallback)).toEqual({ x: 30, y: 40 });
    expect(resolvePosition(node('a'), fallback)).toEqual({ x: 1, y: 2 });
  });

  it('dagre also orders siblings by order_index', () => {
    const edges = [edge('root', 'c', 0), edge('root', 'a', 2), edge('root', 'b', 1)];
    const at = layoutDagre(nodes.slice(0, 4), edges);
    expect(at.get('c')!.x).toBeLessThan(at.get('a')!.x);
  });
});
