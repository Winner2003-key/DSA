import { describe, expect, it } from 'vitest';
import { MAX_BATCH, chunk, planWrites, rowCount } from '../src/batch';
import { planImport } from '../src/diff';
import { graphDataToRows } from '../src/rows';
import type { EdgeRow, NodeRow } from '../src/rows';
import { bookKeys, buildFixture, emptySnapshot, snapshotOf } from './fixtures';

const book = buildFixture();
const plan = planImport({ desired: graphDataToRows(book.data), book: bookKeys(book.data), existing: emptySnapshot() });

describe('chunk', () => {
  it('splits into batches of at most 500 rows', () => {
    expect(MAX_BATCH).toBe(500);
    const rows = Array.from({ length: 1201 }, (_, i) => i);
    expect(chunk(rows).map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunk(rows, 500).flat()).toEqual(rows);
    expect(chunk([])).toEqual([]);
    expect(chunk([1, 2, 3], 1).length).toBe(3);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('planWrites', () => {
  const steps = planWrites(plan);

  it('writes in foreign-key order: graph, characters, nodes, links, edges', () => {
    expect(steps.map((s) => `${s.op}:${s.table}`)).toEqual([
      'upsert:graphs',
      'upsert:bible_characters',
      'upsert:graph_nodes',
      'upsert:graph_nodes',
      'upsert:graph_edges',
    ]);
  });

  it('clears character_id in the first node pass and sets it in the second', () => {
    const first = steps[2];
    const second = steps[3];
    if (first?.op !== 'upsert' || first.table !== 'graph_nodes' || second?.op !== 'upsert' || second.table !== 'graph_nodes') throw new Error('unexpected steps');
    expect(first.rows.every((r) => r.character_id === null)).toBe(true);
    expect(second.rows.length).toBe(3);
    expect(second.rows.every((r) => r.character_id !== null)).toBe(true);
  });

  it('never rewrites unchanged rows', () => {
    const unchanged = planImport({ desired: graphDataToRows(book.data), book: bookKeys(book.data), existing: snapshotOf(book.data) });
    expect(planWrites(unchanged)).toEqual([]);
  });

  it('respects a smaller batch size and counts the rows', () => {
    const small = planWrites(plan, { batchSize: 2 });
    expect(small.filter((s) => s.table === 'graph_nodes' && s.op === 'upsert').length).toBe(5 + 2); // 9 nodes, then 3 linked
    expect(small.every((s) => rowCount(s) <= 2)).toBe(true);
  });

  it('deletes edges before nodes, and only with --prune', () => {
    const existing = snapshotOf(book.data);
    const ghostNode = { ...(existing.nodes[8] as NodeRow), id: 'eeeeeeee-0000-4000-8000-000000000005', node_key: 'ancien[oui]/section-a/classe-un/parti--epsilon' };
    const ghostEdge = { ...(existing.edges[0] as EdgeRow), id: 'ffffffff-0000-4000-8000-000000000006', to_node_id: ghostNode.id };
    existing.nodes.push(ghostNode);
    existing.edges.push(ghostEdge);
    const withGhost = planImport({ desired: graphDataToRows(book.data), book: bookKeys(book.data), existing });
    expect(planWrites(withGhost).length).toBe(0);
    const pruning = planWrites(withGhost, { prune: true }).map((s) => `${s.op}:${s.table}`);
    expect(pruning).toEqual(['delete:graph_edges', 'delete:graph_nodes']);
  });
});
