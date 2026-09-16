// The import itself, with the database behind the GraphStore interface so it can be run against a
// fake store in the tests (a dry run must write nothing at all).

import { GraphIndex, formatBuildReport, formatReport, validateGraph } from '@dsa/core';
import type { ValidationReport } from '@dsa/core';
import type { ImportArgs } from './args';
import { buildBook, SOURCE_DOCUMENT } from './book';
import type { BuiltBook } from './book';
import { planWrites, rowCount } from './batch';
import { planByPage, planImport, projectSnapshot, summarize } from './diff';
import type { ImportPlan, PagePlan, PlanSummary } from './diff';
import type { ScriptEnv } from './env';
import { bullet, pageLine, summaryLines } from './format';
import { graphDataToRows, snapshotToGraphData } from './rows';
import type { DbSnapshot, Json } from './rows';
import { danglingEdges, makeScope, selectScope, spineNodeIds } from './select';
import type { GraphStore, ImportBatchRow } from './store';

export class ImportAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportAbort';
  }
}

export interface ImportDeps {
  store: GraphStore;
  env: ScriptEnv;
  log?: (line: string) => void;
  now?: () => string;
  /** Injected in the tests instead of reading data/book. */
  book?: BuiltBook;
}

export interface ImportResult {
  plan: ImportPlan;
  summary: PlanSummary;
  pages: PagePlan[];
  validation: ValidationReport;
  applied: boolean;
  /** Characters that would be playable once the plan is applied. */
  playableCharacters: number;
  batches: ImportBatchRow[];
  writtenRows: number;
}

export async function runImport(args: ImportArgs, deps: ImportDeps): Promise<ImportResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? (() => new Date().toISOString());

  const built =
    deps.book ??
    buildBook({ graphSlug: args.graph, graphName: args.name, idSalt: deps.env.idSalt });

  log('DSA — importation du livre');
  log(`Graphe : ${args.graph} — ${args.name}`);
  log(`Mode   : ${args.dryRun ? 'simulation (--dry-run, rien n’est écrit)' : 'application (--apply)'}`);
  log(`Pages  : ${args.pages === null ? `tout le livre (${built.pages.length} pages)` : `${args.pages.join(', ')} (+ colonne vertébrale)`}`);
  const options = [args.approve ? '--approve' : null, args.publish ? '--publish' : null, args.prune ? '--prune' : null]
    .filter((o): o is string => o !== null)
    .join(' ');
  if (options !== '') log(`Options: ${options}`);
  log('');
  log(formatBuildReport(built.report, { maxIssues: 20 }));
  if (built.report.errors.length > 0) {
    throw new ImportAbort(
      `${built.report.errors.length} erreur(s) de construction : corrigez data/book, puis relancez « npm run book:validate ».`,
    );
  }

  if (args.pages !== null) {
    const unknown = args.pages.filter((p) => !built.pageNumbers.includes(p));
    if (unknown.length > 0) {
      throw new ImportAbort(
        `Page(s) absente(s) de la transcription : ${unknown.join(', ')}.\n` +
          `Pages disponibles : ${built.pageNumbers.join(', ')}.`,
      );
    }
  }

  const validation = validateGraph(built.data);
  log('');
  log(formatReport(validation, { maxIssuesPerCode: 5 }));
  if (!validation.ok) {
    throw new ImportAbort(
      `${validation.errors.length} erreur(s) de validation : rien n’a été écrit. Corrigez data/book, puis relancez « npm run book:validate ».`,
    );
  }

  const scope = makeScope(built.data, args.pages);
  const selected = selectScope(built.data, scope);
  const desired = graphDataToRows(selected);
  const book = {
    nodeKeys: new Set(built.data.nodes.map((n) => n.nodeKey)),
    edgeIds: new Set(built.data.edges.map((e) => e.id)),
  };

  const existing: DbSnapshot = await deps.store.fetchSnapshot(
    args.graph,
    desired.characters.map((c) => c.id),
  );

  // With --pages, an edge can point at a node that belongs to a page nobody has imported yet.
  const knownIds = new Set([...existing.nodes.map((n) => n.id), ...desired.nodes.map((n) => n.id)]);
  const dangling = danglingEdges(built.data, scope).filter(({ edge }) => ![edge.fromNodeId, edge.toNodeId].every((id) => knownIds.has(id)));
  if (dangling.length > 0) {
    const missing = [...new Set(dangling.flatMap((d) => d.missing))];
    throw new ImportAbort(
      [
        `${dangling.length} arête(s) pointent vers des nœuds absents de la sélection et de la base :`,
        ...bullet(missing),
        'Importez aussi la page qui contient ces nœuds, ou lancez un import complet (sans --pages).',
      ].join('\n'),
    );
  }

  const plan = planImport({
    desired,
    book,
    existing,
    options: {
      approve: args.approve,
      publish: args.publish,
      pages: args.pages,
      graphName: args.name,
      sourceDocument: SOURCE_DOCUMENT,
    },
  });
  const summary = summarize(plan, args.prune);
  const pages = planByPage(plan, spineNodeIds(built.data));

  log('');
  for (const page of pages) log(pageLine(page));
  log('');
  for (const line of summaryLines(summary)) log(line);
  log(`Graphe — ${plan.graph.action === 'INSERT' ? 'créé' : plan.graph.action === 'UPDATE' ? `mis à jour (${plan.graph.changed.join(', ')})` : 'inchangé'}`);

  const preservedNodes = plan.nodes.filter((c) => c.action !== 'INSERT' && c.preserved.length > 0);
  const preservedEdges = plan.edges.filter((c) => c.action !== 'INSERT' && c.preserved.length > 0);
  const preservedCharacters = plan.characters.filter((c) => c.action !== 'INSERT' && c.preserved.length > 0);
  if (preservedNodes.length + preservedEdges.length + preservedCharacters.length > 0) {
    log('');
    log(`Travail d’administration conservé : ${preservedNodes.length} nœuds, ${preservedEdges.length} arêtes, ${preservedCharacters.length} personnages`);
    for (const line of bullet(preservedNodes.slice(0, 5).map((c) => `${c.key} → ${c.preserved.join(', ')}`), 5)) log(line);
  }
  if (plan.admin.nodes.length + plan.admin.edges.length > 0) {
    log(`Lignes créées dans l’admin, jamais modifiées : ${plan.admin.nodes.length} nœuds, ${plan.admin.edges.length} arêtes`);
  }
  if (plan.approvedWithReviewNote.length > 0) {
    log('');
    log(`⚠ --approve a approuvé ${plan.approvedWithReviewNote.length} ligne(s) portant une note « à revoir » :`);
    for (const line of bullet(plan.approvedWithReviewNote)) log(line);
  }
  if (plan.prune.nodes.length + plan.prune.edges.length > 0) {
    log('');
    const verb = args.prune ? 'seront supprimés (--prune)' : 'ne sont plus dans le livre (ajoutez --prune pour les supprimer)';
    log(`⚠ ${plan.prune.nodes.length} nœuds et ${plan.prune.edges.length} arêtes ${verb} :`);
    for (const line of bullet(plan.prune.nodes.map((n) => n.node_key ?? n.id))) log(line);
  }

  const projected = projectSnapshot(existing, plan, args.prune);
  const playableCharacters = countPlayable(projected);
  log('');
  log(`Personnages jouables après import : ${playableCharacters}`);
  if (args.publish && playableCharacters === 0) {
    throw new ImportAbort(
      'Aucun personnage jouable : publier maintenant donnerait « DSA_NO_PLAYABLE_SECRET » à chaque partie.\n' +
        'Approuvez d’abord des pages (admin, ou --pages … --approve), puis relancez avec --publish.',
    );
  }

  const batches = buildBatchRows(args, plan, pages, summary, validation, built, playableCharacters, now());

  if (args.dryRun) {
    log('');
    log(`Simulation terminée : rien n’a été écrit. Relancez avec --apply pour appliquer${args.prune ? ' (y compris les suppressions)' : ''}.`);
    if (args.recordDryRun) {
      for (const row of batches) await deps.store.insertImportBatch(row);
      log(`${batches.length} ligne(s) import_batches enregistrées avec le statut VALIDATED.`);
    }
    return { plan, summary, pages, validation, applied: false, playableCharacters, batches, writtenRows: 0 };
  }

  const steps = planWrites(plan, { prune: args.prune, ...(args.batchSize !== null ? { batchSize: args.batchSize } : {}) });
  let writtenRows = 0;
  log('');
  for (const step of steps) {
    await deps.store.applyStep(step);
    writtenRows += rowCount(step);
    log(`  ${step.op === 'delete' ? 'supprimé' : 'écrit'} ${rowCount(step)} ligne(s) — ${step.table} (${step.label})`);
  }

  for (const row of batches) await deps.store.insertImportBatch({ ...row, status: 'APPLIED', applied_at: now() });

  if (summary.hasChanges) {
    const version = (existing.graph?.version ?? 0) + 1;
    await deps.store.insertGraphVersion({
      graph_id: plan.graph.row.id,
      version,
      status: plan.graph.row.status,
      snapshot: { summary, pages, playableCharacters } as unknown as Json,
      notes: versionNotes(args, summary),
    });
    await deps.store.setGraphVersion(plan.graph.row.id, version);
    log('');
    log(`Version ${version} enregistrée : ${versionNotes(args, summary)}`);
  } else {
    log('');
    log('Rien n’a changé : la version du graphe reste inchangée.');
  }

  log('');
  log(`✓ Import terminé : ${writtenRows} ligne(s) écrites ou supprimées.`);
  if (args.publish) log(`✓ Le graphe ${args.graph} est PUBLISHED.`);
  return { plan, summary, pages, validation, applied: true, playableCharacters, batches, writtenRows };
}

function countPlayable(snapshot: DbSnapshot): number {
  if (!snapshot.graph) return 0;
  try {
    return new GraphIndex(snapshotToGraphData(snapshot)).playableCharacters().length;
  } catch {
    return 0;
  }
}

export function versionNotes(args: ImportArgs, summary: PlanSummary): string {
  const scope = args.pages === null ? 'tout le livre' : `pages ${args.pages.join(', ')}`;
  const parts = [
    `Import du livre (${scope})`,
    `nœuds +${summary.nodes.inserted}/~${summary.nodes.updated}`,
    `arêtes +${summary.edges.inserted}/~${summary.edges.updated}`,
    `personnages +${summary.characters.inserted}/~${summary.characters.updated}`,
  ];
  if (args.prune && summary.pruneNodes + summary.pruneEdges > 0) parts.push(`supprimés ${summary.pruneNodes} nœuds / ${summary.pruneEdges} arêtes`);
  if (args.approve) parts.push('APPROVED');
  if (args.publish) parts.push('PUBLISHED');
  return parts.join(' — ');
}

/** One import_batches row per page of the run, so the admin can review page by page. */
export function buildBatchRows(
  args: ImportArgs,
  plan: ImportPlan,
  pages: PagePlan[],
  summary: PlanSummary,
  validation: ValidationReport,
  built: BuiltBook,
  playableCharacters: number,
  at: string,
): ImportBatchRow[] {
  const fileOf = (page: PagePlan): string => {
    if (page.isSpine) return 'data/book/spine.dsa';
    const found = built.pages.find((p) => p.page === page.page);
    return found?.fileName ?? `data/book/pages/p${String(page.page ?? 0).padStart(3, '0')}.dsa`;
  };
  return pages.map((page) => ({
    graph_id: plan.graph.row.id,
    graph_slug: plan.graph.row.slug,
    source: fileOf(page),
    status: args.dryRun ? ('VALIDATED' as const) : ('APPLIED' as const),
    stats: {
      page: page.isSpine ? 'spine' : page.page,
      nodes: page.nodes,
      edges: page.edges,
      characters: page.characters,
    } as unknown as Json,
    report: {
      generated_at: at,
      dry_run: args.dryRun,
      options: { pages: args.pages, approve: args.approve, publish: args.publish, prune: args.prune },
      totals: summary,
      playable_characters: playableCharacters,
      build_warnings: built.report.warnings.length,
      validation_warnings: validation.warnings.map((w) => `${w.code}: ${w.message}`).slice(0, 50),
      prune_candidates: {
        nodes: plan.prune.nodes.map((n) => n.node_key).slice(0, 200),
        edges: plan.prune.edges.length,
      },
      preserved_admin_fields: plan.nodes
        .filter((c) => c.preserved.length > 0)
        .slice(0, 200)
        .map((c) => ({ node_key: c.key, kept: c.preserved })),
    } as unknown as Json,
    applied_at: args.dryRun ? null : at,
  }));
}
