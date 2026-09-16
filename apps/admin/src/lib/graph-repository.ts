/**
 * Every Supabase call in the admin app lives here. Components receive and
 * return `@dsa/core` types (camelCase); the snake_case rows stay behind
 * `rows.ts`.
 *
 * All access goes through the signed-in admin's session, so RLS
 * (DATABASE_SCHEMA.md §2: graph tables are admin-only) is what actually
 * authorises a write. There is no service role key in this app.
 */
import type { BibleCharacter, GraphData, GraphStatus, ReviewStatus } from '@dsa/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GraphDiff } from './diff';
import { summarize, type DiffSummary } from './diff';
import {
  CHARACTER_COLUMNS,
  EDGE_COLUMNS,
  GRAPH_COLUMNS,
  NODE_COLUMNS,
  fromCharacter,
  fromEdge,
  fromNode,
  toGraph,
  toGraphData,
  type CharacterRow,
  type EdgeRow,
  type GraphRow,
  type NodeRow,
} from './rows';

export interface GraphSummary {
  id: string;
  slug: string;
  name: string;
  status: GraphStatus;
  version: number;
  isActive: boolean;
  nodes: number;
  edges: number;
  characters: number;
  needsReviewNodes: number;
  needsReviewEdges: number;
}

export interface ImportBatch {
  id: string;
  graphSlug: string | null;
  source: string | null;
  status: string;
  /** The page this batch covers, when the importer recorded one. */
  page: number | null;
  stats: Record<string, unknown>;
  report: Record<string, unknown>;
  createdAt: string | null;
  appliedAt: string | null;
}

export interface GraphRepository {
  readonly readOnly: boolean;
  listGraphs(): Promise<GraphSummary[]>;
  loadGraph(slug: string): Promise<GraphData>;
  saveDiff(diff: GraphDiff): Promise<DiffSummary>;
  setGraphStatus(graphId: string, status: GraphStatus): Promise<void>;
  /** Sets the review status of every node and edge of the given source pages. */
  reviewPages(graphId: string, pages: number[], status: ReviewStatus, note: string | null): Promise<number>;
  listImportBatches(graphId: string): Promise<ImportBatch[]>;
}

export class RepositoryError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** PostgREST returns at most 1000 rows per request; the real graph has ~1650 nodes. */
const PAGE_SIZE = 1000;
/** Upserts are sent in batches so a save never becomes one enormous statement. */
const WRITE_BATCH = 500;

export function createSupabaseRepository(supabase: SupabaseClient): GraphRepository {
  async function fetchAll<T>(table: string, columns: string, apply: (q: any) => any): Promise<T[]> {
    const all: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await apply(supabase.from(table).select(columns)).range(from, from + PAGE_SIZE - 1);
      if (error) throw new RepositoryError(`Lecture de ${table} impossible : ${error.message}`, error);
      const batch = (data ?? []) as T[];
      all.push(...batch);
      if (batch.length < PAGE_SIZE) return all;
    }
  }

  async function count(table: string, apply: (q: any) => any): Promise<number> {
    const { count: total, error } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }));
    if (error) throw new RepositoryError(`Comptage de ${table} impossible : ${error.message}`, error);
    return total ?? 0;
  }

  async function writeInBatches<T>(
    rows: T[],
    write: (batch: T[]) => PromiseLike<{ error: { message: string } | null }>,
    what: string,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      const { error } = await write(rows.slice(i, i + WRITE_BATCH));
      if (error) throw new RepositoryError(`Enregistrement (${what}) impossible : ${error.message}`, error);
    }
  }

  return {
    readOnly: false,

    async listGraphs() {
      const { data, error } = await supabase.from('graphs').select(GRAPH_COLUMNS).order('slug');
      if (error) throw new RepositoryError(`Lecture des graphes impossible : ${error.message}`, error);
      const graphs = (data ?? []) as GraphRow[];
      return Promise.all(
        graphs.map(async (row) => {
          const [nodes, edges, characters, needsReviewNodes, needsReviewEdges] = await Promise.all([
            count('graph_nodes', (q) => q.eq('graph_id', row.id)),
            count('graph_edges', (q) => q.eq('graph_id', row.id)),
            count('graph_nodes', (q) => q.eq('graph_id', row.id).eq('node_type', 'CHARACTER')),
            count('graph_nodes', (q) => q.eq('graph_id', row.id).eq('review_status', 'NEEDS_REVIEW')),
            count('graph_edges', (q) => q.eq('graph_id', row.id).eq('review_status', 'NEEDS_REVIEW')),
          ]);
          const graph = toGraph(row);
          return {
            id: graph.id,
            slug: graph.slug,
            name: graph.name,
            status: graph.status,
            version: graph.version,
            isActive: graph.isActive,
            nodes,
            edges,
            characters,
            needsReviewNodes,
            needsReviewEdges,
          } satisfies GraphSummary;
        }),
      );
    },

    async loadGraph(slug) {
      const { data: graphRow, error } = await supabase.from('graphs').select(GRAPH_COLUMNS).eq('slug', slug).maybeSingle();
      if (error) throw new RepositoryError(`Lecture du graphe « ${slug} » impossible : ${error.message}`, error);
      if (!graphRow) throw new RepositoryError(`Aucun graphe « ${slug} ». Vérifiez le slug, ou que votre compte est administrateur.`);
      const graph = graphRow as GraphRow;
      const [nodes, edges, characters] = await Promise.all([
        fetchAll<NodeRow>('graph_nodes', NODE_COLUMNS, (q) => q.eq('graph_id', graph.id).order('node_key')),
        fetchAll<EdgeRow>('graph_edges', EDGE_COLUMNS, (q) => q.eq('graph_id', graph.id).order('from_node_id').order('order_index')),
        // bible_characters is global (no graph_id); the editor needs all of them
        // to search and assign, and the validator to resolve character_id.
        fetchAll<CharacterRow>('bible_characters', CHARACTER_COLUMNS, (q) => q.order('name')),
      ]);
      return toGraphData({ graph, nodes, edges, characters });
    },

    async saveDiff(diff) {
      const summary = summarize(diff);
      if (summary.total === 0) return summary;

      // FK order: characters exist before nodes point at them, nodes exist
      // before edges reference them, and edges go before the nodes they join.
      const characterRows = [...diff.characters.created, ...diff.characters.updated.map((c) => c.after)].map(fromCharacter);
      await writeInBatches(characterRows, (batch) => supabase.from('bible_characters').upsert(batch, { onConflict: 'id' }), 'personnages');

      const nodeRows = [...diff.nodes.created, ...diff.nodes.updated.map((c) => c.after)].map(fromNode);
      await writeInBatches(nodeRows, (batch) => supabase.from('graph_nodes').upsert(batch, { onConflict: 'id' }), 'nœuds');

      const deletedEdgeIds = diff.edges.deleted.map((e) => e.id);
      await writeInBatches(deletedEdgeIds, (batch) => supabase.from('graph_edges').delete().in('id', batch), 'arêtes supprimées');

      const edgeRows = [...diff.edges.created, ...diff.edges.updated.map((c) => c.after)].map(fromEdge);
      await writeInBatches(edgeRows, (batch) => supabase.from('graph_edges').upsert(batch, { onConflict: 'id' }), 'arêtes');

      const deletedNodeIds = diff.nodes.deleted.map((n) => n.id);
      await writeInBatches(deletedNodeIds, (batch) => supabase.from('graph_nodes').delete().in('id', batch), 'nœuds supprimés');

      const deletedCharacterIds = diff.characters.deleted.map((c) => c.id);
      await writeInBatches(deletedCharacterIds, (batch) => supabase.from('bible_characters').delete().in('id', batch), 'personnages supprimés');

      if (diff.graph) {
        const { error } = await supabase
          .from('graphs')
          .update({
            name: diff.graph.after.name,
            description: diff.graph.after.description,
            status: diff.graph.after.status,
            is_active: diff.graph.after.isActive,
            version: diff.graph.after.version,
          })
          .eq('id', diff.graph.after.id);
        if (error) throw new RepositoryError(`Mise à jour du graphe impossible : ${error.message}`, error);
      }
      return summary;
    },

    async setGraphStatus(graphId, status) {
      const { error } = await supabase.from('graphs').update({ status }).eq('id', graphId);
      if (error) throw new RepositoryError(`Changement de statut impossible : ${error.message}`, error);
    },

    async reviewPages(graphId, pages, status, note) {
      if (pages.length === 0) return 0;
      const patch: Record<string, unknown> = { review_status: status };
      if (note !== null) patch.review_note = note;
      const { data: nodes, error: nodeError } = await supabase
        .from('graph_nodes')
        .update(patch)
        .eq('graph_id', graphId)
        .in('source_page', pages)
        .select('id');
      if (nodeError) throw new RepositoryError(`Revue des nœuds impossible : ${nodeError.message}`, nodeError);
      const { data: edges, error: edgeError } = await supabase
        .from('graph_edges')
        .update(patch)
        .eq('graph_id', graphId)
        .in('source_page', pages)
        .select('id');
      if (edgeError) throw new RepositoryError(`Revue des arêtes impossible : ${edgeError.message}`, edgeError);
      return (nodes?.length ?? 0) + (edges?.length ?? 0);
    },

    async listImportBatches(graphId) {
      const { data, error } = await supabase
        .from('import_batches')
        .select('id, graph_slug, source, status, stats, report, created_at, applied_at')
        .eq('graph_id', graphId)
        .order('created_at', { ascending: false })
        .limit(400);
      if (error) {
        // A project whose importer has never run has no rows; a missing table or
        // a policy problem should not take the review page down either.
        return [];
      }
      return (data ?? []).map(toImportBatch);
    },
  };
}

interface ImportBatchRow {
  id: string;
  graph_slug: string | null;
  source: string | null;
  status: string;
  stats: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  created_at: string | null;
  applied_at: string | null;
}

function toImportBatch(row: ImportBatchRow): ImportBatch {
  const stats = row.stats ?? {};
  const report = row.report ?? {};
  return {
    id: row.id,
    graphSlug: row.graph_slug,
    source: row.source,
    status: row.status,
    page: readPage(stats) ?? readPage(report) ?? pageFromSource(row.source),
    stats,
    report,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

function readPage(blob: Record<string, unknown>): number | null {
  const value = blob.page ?? blob.source_page;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The importer names its per-page batches something like "p023.dsa" or "page 23". */
function pageFromSource(source: string | null): number | null {
  if (!source) return null;
  const match = /(?:^|[^0-9])(\d{1,4})(?:[^0-9]|$)/.exec(source);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export function characterLabel(character: BibleCharacter): string {
  return character.description ? `${character.name} — ${character.description}` : character.name;
}
