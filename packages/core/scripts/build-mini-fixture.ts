// npm run fixtures — regenerates fixtures/mini-graph.json from fixtures/mini/*.dsa.

import { writeFileSync } from 'node:fs';
import { formatBuildReport, formatReport, validateGraph } from '../src/index';
import { MINI_JSON, buildMini, serializeGraph } from './load-book';

const { data, report } = buildMini();
console.log(formatBuildReport(report));
const validation = validateGraph(data);
console.log(formatReport(validation));

if (report.errors.length > 0 || !validation.ok) {
  console.error('mini-graph.json NOT written: fix the errors above.');
  process.exitCode = 1;
} else {
  writeFileSync(MINI_JSON, serializeGraph(data), 'utf8');
  console.log(`wrote ${MINI_JSON}`);
}
