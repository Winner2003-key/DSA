// An in-memory GraphStore that records every write, so a dry run can be proved to write nothing.

import type { WriteStep } from '../src/batch';
import { rowCount } from '../src/batch';
import type { DbSnapshot, GraphRow } from '../src/rows';
import type { GraphStore, GraphVersionRow, ImportBatchRow } from '../src/store';

export class FakeGraphStore implements GraphStore {
  readonly steps: WriteStep[] = [];
  readonly batches: ImportBatchRow[] = [];
  readonly versions: GraphVersionRow[] = [];
  readonly versionUpdates: { graphId: string; version: number }[] = [];
  /** Character ids the importer asked for on top of the ones its nodes reference. */
  requestedCharacterIds: string[] = [];

  constructor(private snapshot: DbSnapshot = { graph: null, nodes: [], edges: [], characters: [] }) {}

  async fetchGraph(slug: string): Promise<GraphRow | null> {
    return this.snapshot.graph && this.snapshot.graph.slug === slug ? this.snapshot.graph : null;
  }

  async fetchSnapshot(slug: string, characterIds: string[] = []): Promise<DbSnapshot> {
    this.requestedCharacterIds = characterIds;
    const graph = await this.fetchGraph(slug);
    if (!graph) return { graph: null, nodes: [], edges: [], characters: [] };
    return this.snapshot;
  }

  async applyStep(step: WriteStep): Promise<void> {
    this.steps.push(step);
  }

  async insertImportBatch(row: ImportBatchRow): Promise<void> {
    this.batches.push(row);
  }

  async insertGraphVersion(row: GraphVersionRow): Promise<void> {
    this.versions.push(row);
  }

  async setGraphVersion(graphId: string, version: number): Promise<void> {
    this.versionUpdates.push({ graphId, version });
  }

  /** Every write the store was asked to perform. */
  get writes(): number {
    return this.steps.reduce((n, s) => n + rowCount(s), 0) + this.batches.length + this.versions.length + this.versionUpdates.length;
  }

  get tables(): string[] {
    return this.steps.map((s) => `${s.op}:${s.table}`);
  }
}
