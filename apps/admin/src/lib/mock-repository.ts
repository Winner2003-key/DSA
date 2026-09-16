/**
 * Development-only repository backed by `packages/core/fixtures/mini-graph.json`.
 * It lets the editor and the review page run with no Supabase project, which is
 * how the screenshots in `docs/sessions/reports/S5-screens/` were taken.
 *
 * State lives in module memory, so it is per process: a save is visible while
 * the tab stays open, and is lost on reload. Never enabled in a production
 * build (see `MOCK_MODE` in `env.ts`).
 */
import type { GraphData, GraphStatus, ReviewStatus } from '@dsa/core';
import type { GraphDiff } from './diff';
import { summarize } from './diff';
import type { GraphRepository, GraphSummary, ImportBatch } from './graph-repository';
import { RepositoryError } from './graph-repository';

/** Pages left mid-review in the fixture, so the review screens have real work on them. */
const PENDING_PAGES = new Set([34, 41]);

let cache: GraphData | null = null;

async function loadFixture(): Promise<GraphData> {
  if (cache) return cache;
  const module = await import('@dsa/core/fixtures/mini-graph.json');
  const data = structuredClone((module.default ?? module) as unknown as GraphData);
  for (const node of data.nodes) {
    if (node.sourcePage !== null && PENDING_PAGES.has(node.sourcePage)) {
      node.reviewStatus = 'NEEDS_REVIEW';
      node.reviewNote = 'Relire la page dans le livre.';
    }
  }
  for (const edge of data.edges) {
    if (edge.sourcePage !== null && PENDING_PAGES.has(edge.sourcePage)) edge.reviewStatus = 'NEEDS_REVIEW';
  }
  data.graph = { ...data.graph, name: 'DSA mini (démonstration)', status: 'DRAFT' };
  cache = data;
  return data;
}

function summarizeGraph(data: GraphData): GraphSummary {
  return {
    id: data.graph.id,
    slug: data.graph.slug,
    name: data.graph.name,
    status: data.graph.status,
    version: data.graph.version,
    isActive: data.graph.isActive,
    nodes: data.nodes.length,
    edges: data.edges.length,
    characters: data.nodes.filter((n) => n.nodeType === 'CHARACTER').length,
    needsReviewNodes: data.nodes.filter((n) => n.reviewStatus === 'NEEDS_REVIEW').length,
    needsReviewEdges: data.edges.filter((e) => e.reviewStatus === 'NEEDS_REVIEW').length,
  };
}

export function createMockRepository(): GraphRepository {
  return {
    readOnly: false,

    async listGraphs() {
      return [summarizeGraph(await loadFixture())];
    },

    async loadGraph(slug) {
      const data = await loadFixture();
      if (data.graph.slug !== slug) throw new RepositoryError(`Aucun graphe « ${slug} » dans la démonstration (essayez « ${data.graph.slug} »).`);
      return structuredClone(data);
    },

    async saveDiff(diff: GraphDiff) {
      const data = await loadFixture();
      applyRows(data.characters, diff.characters);
      applyRows(data.nodes, diff.nodes);
      applyRows(data.edges, diff.edges);
      if (diff.graph) data.graph = diff.graph.after;
      return summarize(diff);
    },

    async setGraphStatus(_graphId: string, status: GraphStatus) {
      const data = await loadFixture();
      data.graph = { ...data.graph, status };
    },

    async reviewPages(_graphId: string, pages: number[], status: ReviewStatus, note: string | null) {
      const data = await loadFixture();
      const wanted = new Set(pages);
      let touched = 0;
      for (const row of [...data.nodes, ...data.edges]) {
        if (row.sourcePage === null || !wanted.has(row.sourcePage)) continue;
        row.reviewStatus = status;
        if (note !== null) row.reviewNote = note;
        touched += 1;
      }
      return touched;
    },

    async listImportBatches() {
      const data = await loadFixture();
      const pages = [...new Set(data.nodes.map((n) => n.sourcePage).filter((p): p is number => p !== null))].sort((a, b) => a - b);
      return pages.map<ImportBatch>((page, index) => {
        const nodes = data.nodes.filter((n) => n.sourcePage === page);
        const edges = data.edges.filter((e) => e.sourcePage === page);
        return {
          id: `mock-batch-${page}`,
          graphSlug: data.graph.slug,
          source: `p${String(page).padStart(3, '0')}.dsa`,
          status: PENDING_PAGES.has(page) ? 'VALIDATED' : 'APPLIED',
          page,
          stats: { page, nodes: nodes.length, edges: edges.length },
          report: { page, warnings: [], summary: `${nodes.length} nœuds, ${edges.length} arêtes` },
          createdAt: new Date(Date.UTC(2026, 8, 15, 9, index)).toISOString(),
          appliedAt: PENDING_PAGES.has(page) ? null : new Date(Date.UTC(2026, 8, 15, 9, index)).toISOString(),
        };
      });
    },
  };
}

function applyRows<T extends { id: string }>(target: T[], diff: { created: T[]; updated: { after: T }[]; deleted: T[] }): void {
  const deleted = new Set(diff.deleted.map((row) => row.id));
  const updated = new Map(diff.updated.map((change) => [change.after.id, change.after]));
  for (let i = target.length - 1; i >= 0; i -= 1) {
    const row = target[i] as T;
    if (deleted.has(row.id)) target.splice(i, 1);
    else {
      const next = updated.get(row.id);
      if (next) target[i] = next;
    }
  }
  target.push(...diff.created);
}
