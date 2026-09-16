import { describe, expect, it } from 'vitest';
import { BOOK_DIR, readBookDir } from '../scripts/load-book';
import { buildGraphData, formatBuildReport, formatReport, validateGraph } from '../src/index';

describe('real book (data/book)', () => {
  it('parses spine and every existing page, and resolves every @attach', () => {
    const { spine, pages } = readBookDir(BOOK_DIR);
    expect(pages.length).toBeGreaterThan(0);
    expect([...spine.errors, ...pages.flatMap((p) => p.errors)].map((e) => e.message)).toEqual([]);

    const { data, report } = buildGraphData('livre', spine, pages, { graphName: 'DSA — Découverte Sans Alphabet', sourceDocument: 'the source book (PDF, not in the repo)', allowUnsalted: true });
    expect(report.errors.filter((e) => e.code === 'PARSE_ERROR' || e.code === 'UNRESOLVED_ATTACH').map((e) => e.message)).toEqual([]);
    expect(new Set(data.nodes.map((n) => n.id)).size).toBe(data.nodes.length);

    const validation = validateGraph(data);
    console.log(`\n=== data/book build (${pages.length} pages) ===\n${formatBuildReport(report, { maxIssues: 0 })}`);
    console.log(`=== validateGraph ===\n${formatReport(validation, { maxIssuesPerCode: 3 })}\n`);
    expect(validation.stats.nodes).toBe(data.nodes.length);
  });
});
