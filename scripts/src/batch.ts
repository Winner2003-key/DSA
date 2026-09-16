// Write plan: batches of at most 500 rows, in foreign-key order.
//
// graphs → bible_characters → graph_nodes (character_id cleared) → graph_nodes (character_id set)
// → graph_edges → delete edges → delete nodes.
//
// Nodes are written twice on purpose: the first pass can create a node whose character row is only
// inserted in the same run, and the second pass links them once every row exists.

import type { ImportPlan } from './diff';
import type { CharacterRow, EdgeRow, GraphRow, NodeRow } from './rows';

export const MAX_BATCH = 500;

export type TableName = 'graphs' | 'bible_characters' | 'graph_nodes' | 'graph_edges';

export type WriteStep =
  | { op: 'upsert'; table: 'graphs'; rows: GraphRow[]; label: string }
  | { op: 'upsert'; table: 'bible_characters'; rows: CharacterRow[]; label: string }
  | { op: 'upsert'; table: 'graph_nodes'; rows: NodeRow[]; label: string }
  | { op: 'upsert'; table: 'graph_edges'; rows: EdgeRow[]; label: string }
  | { op: 'delete'; table: 'graph_edges' | 'graph_nodes'; ids: string[]; label: string };

export function chunk<T>(rows: T[], size: number = MAX_BATCH): T[][] {
  if (size < 1) throw new Error('batch size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface WritePlanOptions {
  /** Delete the rows that disappeared from the transcription. */
  prune?: boolean;
  batchSize?: number;
}

/** The ordered list of writes that applies the plan. Rows that are UNCHANGED are not written again. */
export function planWrites(plan: ImportPlan, opts: WritePlanOptions = {}): WriteStep[] {
  const size = opts.batchSize ?? MAX_BATCH;
  const steps: WriteStep[] = [];

  if (plan.graph.action !== 'UNCHANGED') steps.push({ op: 'upsert', table: 'graphs', rows: [plan.graph.row], label: 'graphe' });

  const characters = plan.characters.filter((c) => c.action !== 'UNCHANGED').map((c) => c.row);
  chunk(characters, size).forEach((rows, i) => steps.push({ op: 'upsert', table: 'bible_characters', rows, label: `personnages ${i + 1}` }));

  const nodes = plan.nodes.filter((c) => c.action !== 'UNCHANGED').map((c) => c.row);
  chunk(
    nodes.map((row) => ({ ...row, character_id: null })),
    size,
  ).forEach((rows, i) => steps.push({ op: 'upsert', table: 'graph_nodes', rows, label: `nœuds ${i + 1}` }));
  const linked = nodes.filter((row) => row.character_id !== null);
  chunk(linked, size).forEach((rows, i) => steps.push({ op: 'upsert', table: 'graph_nodes', rows, label: `nœuds ↔ personnages ${i + 1}` }));

  const edges = plan.edges.filter((c) => c.action !== 'UNCHANGED').map((c) => c.row);
  chunk(edges, size).forEach((rows, i) => steps.push({ op: 'upsert', table: 'graph_edges', rows, label: `arêtes ${i + 1}` }));

  if (opts.prune === true) {
    chunk(plan.prune.edges.map((r) => r.id), size).forEach((ids, i) =>
      steps.push({ op: 'delete', table: 'graph_edges', ids, label: `arêtes supprimées ${i + 1}` }),
    );
    chunk(plan.prune.nodes.map((r) => r.id), size).forEach((ids, i) =>
      steps.push({ op: 'delete', table: 'graph_nodes', ids, label: `nœuds supprimés ${i + 1}` }),
    );
  }
  return steps;
}

export const rowCount = (step: WriteStep): number => (step.op === 'delete' ? step.ids.length : step.rows.length);
