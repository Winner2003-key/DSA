#!/usr/bin/env tsx
// npm run book:validate — builds data/book with @dsa/core and reports, without touching the database.
//
//   npm run book:validate
//   npm run book:validate -- --approved          # how many characters would be playable once approved
//   npm run book:validate -- --json rapport.json
//
// Exit code 1 when the build or the validation found errors.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatBuildReport, formatReport, validateGraph } from '@dsa/core';
import { UsageError, parseValidateArgs } from '../src/args';
import { buildBook } from '../src/book';
import { loadIdSalt } from '../src/env';
import { statsTable } from '../src/format';
import { BOOK_DIR, repoRelative } from '../src/paths';
import { pageStats, spineNodeIds } from '../src/select';

const USAGE = `Usage : npm run book:validate [-- options]

  --approved       simule un graphe entièrement APPROVED (montre le nombre de personnages jouables)
  --graph <slug>   slug du graphe (défaut : livre)
  --json <fichier> écrit le rapport complet en JSON
  --help           affiche cette aide

Lit data/book (hors dépôt). N'écrit rien dans la base.
Le sel DSA_ID_SALT est utilisé s'il est présent dans scripts/.env ; sinon les identifiants sont
calculés sans sel, ce qui suffit pour une vérification locale mais ne correspond pas à la base.`;

function main(argv: string[]): number {
  const args = parseValidateArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const salt = loadIdSalt();
  const built = buildBook({
    graphSlug: args.graph,
    idSalt: salt,
    allowUnsalted: salt === null,
    ...(args.approved ? { defaultReviewStatus: 'APPROVED' as const } : {}),
  });
  const validation = validateGraph(built.data);
  const stats = pageStats(built.data, spineNodeIds(built.data));

  console.log(`DSA — validation du livre (${repoRelative(BOOK_DIR)})`);
  console.log(`Graphe : ${args.graph}${args.approved ? '  [--approved : tout est simulé APPROVED]' : ''}`);
  console.log(`Sel    : ${salt === null ? 'absent (identifiants NON salés, vérification locale seulement)' : 'présent (identifiants salés)'}`);
  console.log('');
  console.log(formatBuildReport(built.report, { maxIssues: 20 }));
  console.log('');
  console.log(formatReport(validation, { maxIssuesPerCode: 5 }));
  console.log('');
  console.log(statsTable(stats, built.data.characters.length));

  if (args.json !== null) {
    const file = resolve(process.cwd(), args.json);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          graph: args.graph,
          generatedAt: new Date().toISOString(),
          salted: salt !== null,
          approvedSimulation: args.approved,
          build: built.report,
          validation,
          pages: stats,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nRapport JSON écrit dans ${repoRelative(file)}`);
  }

  const errors = built.report.errors.length + validation.errors.length;
  console.log('');
  console.log(errors === 0 ? '✓ Le livre est valide.' : `✗ ${errors} erreur(s) : corrigez data/book avant d'importer.`);
  return errors === 0 ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`Erreur : ${error.message}\n`);
    console.error(USAGE);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
