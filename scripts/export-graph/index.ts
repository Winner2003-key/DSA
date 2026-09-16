#!/usr/bin/env tsx
// npm run book:export — writes the graph held by the database to a GraphData JSON file.
//
//   npm run book:export -- --out sauvegarde-livre.json
//
// This is the admin's backup: it contains the review statuses, the editor positions and every
// admin edit, which the transcription does not. Keep it outside the repository.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UsageError, parseExportArgs } from '../src/args';
import { EnvError, loadEnv } from '../src/env';
import { repoRelative } from '../src/paths';
import { snapshotToGraphData } from '../src/rows';
import { SupabaseGraphStore } from '../src/store';

const USAGE = `Usage : npm run book:export -- --out <fichier.json> [options]

  --out <fichier>   fichier de sortie (obligatoire)
  --graph <slug>    slug du graphe (défaut : livre)
  --help            affiche cette aide

Variables requises dans scripts/.env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.`;

async function main(argv: string[]): Promise<number> {
  const args = parseExportArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.out === null) throw new UsageError('--out <fichier.json> est obligatoire');

  const env = loadEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const store = new SupabaseGraphStore(env);
  const snapshot = await store.fetchSnapshot(args.graph);
  if (!snapshot.graph) {
    console.error(`✗ Aucun graphe « ${args.graph} » dans la base. Importez-le d'abord (npm run book:import -- --apply).`);
    return 1;
  }
  const data = snapshotToGraphData(snapshot);
  const file = resolve(process.cwd(), args.out);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `✓ ${data.nodes.length} nœuds, ${data.edges.length} arêtes et ${data.characters.length} personnages ` +
      `exportés depuis « ${args.graph} » (version ${data.graph.version}, ${data.graph.status}) vers ${repoRelative(file)}`,
  );
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
    } else if (error instanceof EnvError) {
      console.error(`\n✗ ${error.message}`);
    } else {
      console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  });
