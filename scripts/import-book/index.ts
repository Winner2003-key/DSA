#!/usr/bin/env tsx
// npm run book:import — writes data/book into Supabase, idempotently.
//
//   npm run book:import -- --dry-run            # default: shows everything, writes nothing
//   npm run book:import -- --apply
//   npm run book:import -- --pages 8,9,23 --approve --apply
//   npm run book:import -- --publish --apply
//
// Needs scripts/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSA_ID_SALT). See IMPORT_GUIDE.md.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UsageError, parseImportArgs } from '../src/args';
import { EnvError, loadEnv } from '../src/env';
import { ImportAbort, runImport } from '../src/import';
import { repoRelative } from '../src/paths';
import { SupabaseGraphStore } from '../src/store';

const USAGE = `Usage : npm run book:import -- [options]

  --dry-run           simulation : affiche ce qui serait créé, modifié ou inchangé (défaut)
  --apply             applique réellement les écritures
  --graph <slug>      slug du graphe (défaut : livre)
  --name <texte>      nom du graphe (défaut : DSA — Découverte Sans Alphabet)
  --pages 8,9,23      limite aux pages indiquées (la colonne vertébrale est toujours incluse ; 8-12 accepté)
  --approve           marque APPROVED les lignes importées de ces pages
  --publish           passe le graphe en PUBLISHED (refusé si la validation échoue)
  --prune             supprime les nœuds et arêtes dont la clé n'existe plus dans la transcription
  --json <fichier>    écrit le rapport de l'import en JSON
  --record-dry-run    enregistre les lignes import_batches VALIDATED d'une simulation
  --batch-size <n>    taille des lots (défaut : 500)
  --help              affiche cette aide

Variables requises dans scripts/.env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSA_ID_SALT.`;

async function main(argv: string[]): Promise<number> {
  const args = parseImportArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const env = loadEnv();
  const store = new SupabaseGraphStore(env);
  const result = await runImport(args, { store, env });

  if (args.json !== null) {
    const file = resolve(process.cwd(), args.json);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          graph: args.graph,
          generatedAt: new Date().toISOString(),
          applied: result.applied,
          options: { pages: args.pages, approve: args.approve, publish: args.publish, prune: args.prune },
          summary: result.summary,
          pages: result.pages,
          playableCharacters: result.playableCharacters,
          prune: {
            nodes: result.plan.prune.nodes.map((n) => n.node_key),
            edges: result.plan.prune.edges.map((e) => e.id),
          },
          preserved: result.plan.nodes.filter((c) => c.preserved.length > 0).map((c) => ({ nodeKey: c.key, kept: c.preserved })),
          batches: result.batches.map((b) => ({ source: b.source, status: b.status, stats: b.stats })),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nRapport JSON écrit dans ${repoRelative(file)}`);
  }
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`Erreur : ${error.message}\n`);
      console.error(USAGE);
    } else if (error instanceof EnvError || error instanceof ImportAbort) {
      console.error(`\n✗ ${error.message}`);
    } else {
      console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  });
