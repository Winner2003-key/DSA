import { describe, expect, it } from 'vitest';
import type { ImportArgs } from '../src/args';
import { DEFAULT_GRAPH_NAME, SOURCE_DOCUMENT } from '../src/book';
import { ImportAbort, runImport } from '../src/import';
import type { ScriptEnv } from '../src/env';
import { FIXTURE_SALT, FIXTURE_SLUG, buildFixture, findNode, snapshotOf } from './fixtures';
import { FakeGraphStore } from './fake-store';

const env: ScriptEnv = { supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'service-role', idSalt: FIXTURE_SALT };
const book = buildFixture();
const ALPHA = 'ancien[oui]/section-a/classe-un/le-premier--alpha';

const args = (over: Partial<ImportArgs> = {}): ImportArgs => ({
  graph: FIXTURE_SLUG,
  name: DEFAULT_GRAPH_NAME,
  dryRun: true,
  pages: null,
  approve: false,
  publish: false,
  prune: false,
  json: null,
  recordDryRun: false,
  batchSize: null,
  help: false,
  ...over,
});

/** The fixture graph as the importer would have written it, so a re-run really is a no-op. */
const matchingSnapshot = () => {
  const snapshot = snapshotOf(book.data);
  if (snapshot.graph) {
    snapshot.graph.name = DEFAULT_GRAPH_NAME;
    snapshot.graph.source_document = SOURCE_DOCUMENT;
  }
  return snapshot;
};

const run = async (over: Partial<ImportArgs> = {}, store = new FakeGraphStore()) => {
  const lines: string[] = [];
  const result = await runImport(args(over), { store, env, book, log: (l) => lines.push(l), now: () => '2026-09-16T10:00:00.000Z' });
  return { result, store, lines, out: lines.join('\n') };
};

describe('dry run', () => {
  it('writes absolutely nothing', async () => {
    const { result, store, out } = await run();
    expect(store.writes).toBe(0);
    expect(store.steps).toEqual([]);
    expect(store.batches).toEqual([]);
    expect(store.versions).toEqual([]);
    expect(store.versionUpdates).toEqual([]);
    expect(result.applied).toBe(false);
    expect(result.writtenRows).toBe(0);
    expect(out).toContain('rien n’a été écrit');
  });

  it('prints one line per page, in the brief’s format', async () => {
    const { out, result } = await run();
    expect(out).toContain('Colonne vertébrale — 4 nœuds (+4), 3 arêtes (+3), 0 personnage');
    expect(out).toContain('Page 1 — 3 nœuds (+3), 3 arêtes (+3), 2 personnages');
    expect(out).toContain('Page 2 — 2 nœuds (+2), 2 arêtes (+2), 1 personnage');
    expect(result.summary.nodes).toMatchObject({ total: 9, inserted: 9, updated: 0, unchanged: 0 });
  });

  it('asks the database for the characters it is about to write', async () => {
    const { store, result } = await run();
    expect(store.requestedCharacterIds.length).toBe(result.plan.characters.length);
  });

  it('records VALIDATED batches only when asked', async () => {
    const { store } = await run({ recordDryRun: true });
    expect(store.steps).toEqual([]);
    expect(store.batches.map((b) => b.status)).toEqual(['VALIDATED', 'VALIDATED', 'VALIDATED']);
    expect(store.batches.map((b) => b.source)).toEqual(['data/book/spine.dsa', 'data/book/pages/p001.dsa', 'data/book/pages/p002.dsa']);
    expect(store.batches.every((b) => b.applied_at === null)).toBe(true);
  });

  it('reports what would be unchanged when the database already matches', async () => {
    const { result, out } = await run({}, new FakeGraphStore(matchingSnapshot()));
    expect(result.summary.nodes).toMatchObject({ inserted: 0, updated: 0, unchanged: 9 });
    expect(out).toContain('Page 1 — 3 nœuds (=), 3 arêtes (=), 2 personnages');
  });
});

describe('--apply', () => {
  it('writes in foreign-key order, logs one import_batches row per page and bumps the version', async () => {
    const { store, result, out } = await run({ dryRun: false });
    expect(store.tables).toEqual([
      'upsert:graphs',
      'upsert:bible_characters',
      'upsert:graph_nodes',
      'upsert:graph_nodes',
      'upsert:graph_edges',
    ]);
    expect(result.applied).toBe(true);
    expect(result.writtenRows).toBe(1 + 3 + 9 + 3 + 8);
    expect(store.batches.map((b) => b.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
    expect(store.batches[1]?.stats).toMatchObject({ page: 1 });
    expect(store.versions[0]).toMatchObject({ version: 1, status: 'DRAFT' });
    expect(store.versions[0]?.notes).toContain('Import du livre (tout le livre)');
    expect(store.versionUpdates).toEqual([{ graphId: book.data.graph.id, version: 1 }]);
    expect(out).toContain('✓ Import terminé');
  });

  it('leaves the version alone when nothing changed', async () => {
    const { store, out } = await run({ dryRun: false }, new FakeGraphStore(matchingSnapshot()));
    expect(store.steps).toEqual([]);
    expect(store.versions).toEqual([]);
    expect(store.versionUpdates).toEqual([]);
    expect(out).toContain('la version du graphe reste inchangée');
    expect(store.batches.length).toBe(3);
  });

  it('renames and re-stamps the graph row when the run asks for another name', async () => {
    const { result } = await run({ dryRun: false }, new FakeGraphStore(snapshotOf(book.data)));
    expect(result.plan.graph.action).toBe('UPDATE');
    expect(result.plan.graph.changed.sort()).toEqual(['name', 'source_document']);
    expect(result.plan.graph.row.source_document).toBe(SOURCE_DOCUMENT);
  });

  it('bumps from the version the database holds', async () => {
    const snapshot = matchingSnapshot();
    if (snapshot.graph) snapshot.graph.version = 7;
    findNode(snapshot.nodes, ALPHA).label = 'ANCIEN NOM';
    const { store } = await run({ dryRun: false }, new FakeGraphStore(snapshot));
    expect(store.versions[0]?.version).toBe(8);
    expect(store.versionUpdates).toEqual([{ graphId: book.data.graph.id, version: 8 }]);
  });
});

describe('--pages', () => {
  it('writes the spine and the chosen page only', async () => {
    const { result, store, out } = await run({ dryRun: false, pages: [1] });
    expect(result.pages.map((p) => p.label)).toEqual(['spine', '1']);
    expect(result.summary.nodes.total).toBe(7);
    expect(out).toContain('Pages  : 1 (+ colonne vertébrale)');
    const nodeSteps = store.steps.filter((s) => s.op === 'upsert' && s.table === 'graph_nodes');
    expect(nodeSteps.length).toBe(2);
  });

  it('refuses a page the transcription does not have', async () => {
    const store = new FakeGraphStore();
    await expect(runImport(args({ pages: [1, 404] }), { store, env, book, log: () => {} })).rejects.toThrow(/absente\(s\) de la transcription : 404/);
    expect(store.writes).toBe(0);
  });

  it('refuses when a selected page hangs off a node nobody imported', async () => {
    const deep = buildFixture({
      page1: '@page 1\n@attach ancien[oui]/section-a\n\nCLASSE UN {classe}\n  Le premier • ALPHA\n',
      page2: '@page 2\n@attach ancien[oui]/section-a/classe-un\n\nSOUS GROUPE\n  Le second • BETA\n',
    });
    const store = new FakeGraphStore();
    await expect(
      runImport(args({ pages: [2] }), { store, env, book: deep, log: () => {}, now: () => '2026-09-16T10:00:00.000Z' }),
    ).rejects.toThrow(ImportAbort);
    expect(store.writes).toBe(0);
  });
});

describe('--approve, --prune and --publish', () => {
  it('approves the rows of the selection and warns about the {review} ones', async () => {
    const { result, out } = await run({ approve: true });
    expect(new Set(result.plan.nodes.map((c) => c.row.review_status))).toEqual(new Set(['APPROVED']));
    expect(out).toContain('a approuvé 2 ligne(s) portant une note « à revoir »');
    expect(result.playableCharacters).toBe(3);
  });

  it('only reports rows that vanished, until --prune is given', async () => {
    const snapshot = snapshotOf(book.data);
    const ghost = { ...findNode(snapshot.nodes, ALPHA), id: '99999999-0000-4000-8000-000000000009', node_key: 'ancien[oui]/section-a/classe-un/parti--delta' };
    snapshot.nodes.push(ghost);
    const reported = await run({}, new FakeGraphStore(snapshot));
    expect(reported.out).toContain('ajoutez --prune pour les supprimer');
    expect(reported.result.plan.prune.nodes.map((n) => n.node_key)).toEqual([ghost.node_key]);

    const pruning = await run({ dryRun: false, prune: true }, new FakeGraphStore(snapshot));
    expect(pruning.store.tables).toContain('delete:graph_nodes');
  });

  it('refuses to publish a graph where nothing is playable', async () => {
    await expect(run({ dryRun: false, publish: true })).rejects.toThrow(/DSA_NO_PLAYABLE_SECRET/);
  });

  it('publishes once the rows are approved', async () => {
    const { result, out } = await run({ dryRun: false, publish: true, approve: true });
    expect(result.plan.graph.row.status).toBe('PUBLISHED');
    expect(out).toContain('est PUBLISHED');
  });
});

describe('aborts', () => {
  it('stops on a build error without reading or writing anything', async () => {
    const broken = buildFixtureWithError();
    const store = new FakeGraphStore();
    await expect(runImport(args(), { store, env, book: broken, log: () => {} })).rejects.toThrow(ImportAbort);
    expect(store.writes).toBe(0);
  });
});

function buildFixtureWithError() {
  const good = buildFixture();
  return {
    ...good,
    report: { ...good.report, errors: [{ code: 'PARSE_ERROR' as const, file: 'data/book/pages/p001.dsa', line: 3, message: 'data/book/pages/p001.dsa:3: unknown tag {oops}' }] },
  };
}
