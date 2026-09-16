// Console formatting. The owner reads these lines, so they are in French, like the game.
// The blocks produced by @dsa/core (formatBuildReport, formatReport) are printed as they come.

import type { Counts, PagePlan, PlanSummary } from './diff';
import type { PageStats } from './select';

export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** `(+61)`, `(+61, ~3)`, `(~3)` or `(=)`. */
export function delta(counts: Counts): string {
  const parts: string[] = [];
  if (counts.inserted > 0) parts.push(`+${counts.inserted}`);
  if (counts.updated > 0) parts.push(`~${counts.updated}`);
  return `(${parts.length > 0 ? parts.join(', ') : '='})`;
}

export const pageTitle = (label: string): string => (label === 'spine' ? 'Colonne vertébrale' : label === '—' ? 'Sans page' : `Page ${label}`);

/** `Page 23 — 61 nœuds (+61), 60 arêtes (+60), 48 personnages` */
export function pageLine(p: PagePlan): string {
  return [
    `${pageTitle(p.label)} — `,
    `${plural(p.nodes.total, 'nœud')} ${delta(p.nodes)}, `,
    `${plural(p.edges.total, 'arête')} ${delta(p.edges)}, `,
    plural(p.characters, 'personnage'),
  ].join('');
}

export function summaryLines(summary: PlanSummary): string[] {
  return [
    `Total — ${plural(summary.nodes.total, 'nœud')} ${delta(summary.nodes)}, ` +
      `${plural(summary.edges.total, 'arête')} ${delta(summary.edges)}, ` +
      `${plural(summary.characters.total, 'personnage')} ${delta(summary.characters)}`,
    `Inchangés — ${summary.nodes.unchanged} nœuds, ${summary.edges.unchanged} arêtes, ${summary.characters.unchanged} personnages`,
  ];
}

/** A plain text table with right-aligned numbers. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const all = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => [...String(r[i] ?? '')].length)));
  const pad = (cell: string | number, i: number): string => {
    const text = String(cell ?? '');
    const width = widths[i] ?? text.length;
    const space = ' '.repeat(Math.max(0, width - [...text].length));
    return i === 0 ? text + space : space + text;
  };
  const line = (cells: (string | number)[]): string => cells.map(pad).join('  ');
  return [line(headers), widths.map((w) => '─'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/** `totalCharacters` is passed in because one character can appear on several pages. */
export function statsTable(rows: PageStats[], totalCharacters?: number): string {
  const review = (n: number, e: number): string => `${n}+${e}`;
  const body = rows.map((r) => [pageTitle(r.label), r.nodes, r.edges, r.characters, review(r.needsReviewNodes, r.needsReviewEdges)]);
  const total = rows.reduce(
    (acc, r) => ({
      nodes: acc.nodes + r.nodes,
      edges: acc.edges + r.edges,
      characters: acc.characters + r.characters,
      reviewNodes: acc.reviewNodes + r.needsReviewNodes,
      reviewEdges: acc.reviewEdges + r.needsReviewEdges,
    }),
    { nodes: 0, edges: 0, characters: 0, reviewNodes: 0, reviewEdges: 0 },
  );
  return table(
    ['Source', 'Nœuds', 'Arêtes', 'Personnages', 'NEEDS_REVIEW (nœuds+arêtes)'],
    [...body, ['TOTAL', total.nodes, total.edges, totalCharacters ?? total.characters, review(total.reviewNodes, total.reviewEdges)]],
  );
}

export const bullet = (items: string[], max = 10): string[] => {
  const shown = items.slice(0, max).map((i) => `    • ${i}`);
  if (items.length > max) shown.push(`    • … et ${items.length - max} de plus`);
  return shown;
};
