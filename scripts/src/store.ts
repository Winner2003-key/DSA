// The only place that talks to Supabase. Everything else works on plain rows, so it can be tested
// without a database (see test/fake-store.ts).

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WriteStep } from './batch';
import { rowCount } from './batch';
import type { ScriptEnv } from './env';
import type { CharacterRow, DbSnapshot, EdgeRow, GraphRow, Json, NodeRow } from './rows';

/** PostgREST caps a response at 1000 rows by default. */
const PAGE = 1000;

/**
 * `.in('id', ids)` puts every id in the request URL (37 characters each). Supabase rejects URLs of a
 * few KB with "Bad Request", so id filters are sent in small groups: 100 ids ≈ 3.8 KB.
 */
export const ID_FILTER_CHUNK = 100;

export function chunkIds(ids: readonly string[], size: number = ID_FILTER_CHUNK): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < ids.length; i += size) groups.push(ids.slice(i, i + size));
  return groups;
}

export interface ImportBatchRow {
  graph_id: string | null;
  graph_slug: string;
  source: string;
  status: 'PENDING' | 'VALIDATED' | 'APPLIED' | 'FAILED' | 'DISCARDED';
  stats: Json;
  report: Json;
  applied_at?: string | null;
}

export interface GraphVersionRow {
  graph_id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
  snapshot: Json;
  notes: string;
}

export interface GraphStore {
  fetchGraph(slug: string): Promise<GraphRow | null>;
  /**
   * The graph and every row that belongs to it. `characterIds` adds characters the book is about to
   * write but that no node points to yet (for example after a run that stopped half way).
   */
  fetchSnapshot(slug: string, characterIds?: string[]): Promise<DbSnapshot>;
  applyStep(step: WriteStep): Promise<void>;
  insertImportBatch(row: ImportBatchRow): Promise<void>;
  insertGraphVersion(row: GraphVersionRow): Promise<void>;
  setGraphVersion(graphId: string, version: number): Promise<void>;
}

export class SupabaseGraphStore implements GraphStore {
  private readonly client: SupabaseClient;

  constructor(env: ScriptEnv) {
    this.client = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-dsa-importer': 'scripts/import-book' } },
    });
  }

  async fetchGraph(slug: string): Promise<GraphRow | null> {
    const { data, error } = await this.client.from('graphs').select('*').eq('slug', slug).maybeSingle();
    if (error) throw dbError('lecture de graphs', error);
    return (data as GraphRow | null) ?? null;
  }

  async fetchSnapshot(slug: string, characterIds: string[] = []): Promise<DbSnapshot> {
    const graph = await this.fetchGraph(slug);
    if (!graph) return { graph: null, nodes: [], edges: [], characters: [] };
    const nodes: NodeRow[] = [];
    const edges: EdgeRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from('graph_nodes')
        .select('*')
        .eq('graph_id', graph.id)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw dbError('lecture de graph_nodes', error);
      const rows = (data ?? []) as NodeRow[];
      nodes.push(...rows);
      if (rows.length < PAGE) break;
    }
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from('graph_edges')
        .select('*')
        .eq('graph_id', graph.id)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw dbError('lecture de graph_edges', error);
      const rows = (data ?? []) as EdgeRow[];
      edges.push(...rows);
      if (rows.length < PAGE) break;
    }
    const wanted = [
      ...new Set([...nodes.map((n) => n.character_id).filter((id): id is string => id !== null), ...characterIds]),
    ];
    const characters: CharacterRow[] = [];
    for (const ids of chunkIds(wanted)) {
      const { data, error } = await this.client.from('bible_characters').select('*').in('id', ids);
      if (error) throw dbError('lecture de bible_characters', error);
      characters.push(...((data ?? []) as CharacterRow[]));
    }
    return { graph, nodes, edges, characters };
  }

  async applyStep(step: WriteStep): Promise<void> {
    if (rowCount(step) === 0) return;
    if (step.op === 'delete') {
      for (const ids of chunkIds(step.ids)) {
        const { error } = await this.client.from(step.table).delete().in('id', ids);
        if (error) throw dbError(`suppression dans ${step.table}`, error);
      }
      return;
    }
    const { error } = await this.client.from(step.table).upsert(step.rows as never, { onConflict: 'id' });
    if (error) throw dbError(`écriture dans ${step.table}`, error);
  }

  async insertImportBatch(row: ImportBatchRow): Promise<void> {
    const { error } = await this.client.from('import_batches').insert(row as never);
    if (error) throw dbError('écriture dans import_batches', error);
  }

  async insertGraphVersion(row: GraphVersionRow): Promise<void> {
    const { error } = await this.client.from('graph_versions').upsert(row as never, { onConflict: 'graph_id,version' });
    if (error) throw dbError('écriture dans graph_versions', error);
  }

  async setGraphVersion(graphId: string, version: number): Promise<void> {
    const { error } = await this.client.from('graphs').update({ version }).eq('id', graphId);
    if (error) throw dbError('mise à jour de graphs.version', error);
  }
}

export function dbError(
  what: string,
  error: { message: string; hint?: string | null; details?: string | null; code?: string },
): Error {
  const firstLine = (value?: string | null): string | null => {
    const line = (value ?? '').split('\n')[0]?.trim() ?? '';
    return line === '' ? null : line;
  };
  const parts = [`Erreur Supabase pendant la ${what} : ${firstLine(error.message) ?? 'erreur inconnue'}`];
  if (error.code) parts.push(`code ${error.code}`);
  const details = firstLine(error.details);
  if (details && details !== firstLine(error.message)) parts.push(details);
  const hint = firstLine(error.hint);
  if (hint) parts.push(hint);
  const text = parts.join(' — ');
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(`${error.message} ${error.details ?? ''}`)) {
    return new Error(`${text}\nVérifiez SUPABASE_URL dans scripts/.env et votre connexion internet.`);
  }
  if (error.code === '42501' || /permission denied|JWT/i.test(error.message)) {
    return new Error(`${text}\nVérifiez SUPABASE_SERVICE_ROLE_KEY dans scripts/.env (la clé service_role, pas la clé anon).`);
  }
  return new Error(text);
}
