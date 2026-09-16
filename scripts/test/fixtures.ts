// Invented transcription fixtures. The real book is private (data/book is gitignored), so nothing
// here may come from it: these names and clues are made up.

import { buildGraphData, parsePage, parseSpine } from '@dsa/core';
import type { GraphData } from '@dsa/core';
import type { BuiltBook } from '../src/book';
import type { CharacterRow, DbSnapshot, EdgeRow, NodeRow } from '../src/rows';
import { graphDataToRows } from '../src/rows';

export const FIXTURE_SALT = '11112222-3333-4444-5555-666677778888';
export const FIXTURE_SLUG = 'fixture';

export const SPINE = `START DSA
  DÉBUT -> QUESTION ANCIEN @p1
    OUI -> CATEGORY SECTION A @p1
    NON -> CATEGORY SECTION B @p2
`;

export const PAGE_1 = `@page 1
@printed 1
@attach ancien[oui]/section-a

CLASSE UN {classe}
  Le premier • ALPHA
  Le second • BETA
`;

export const PAGE_2 = `@page 2
@attach ancien[non]/section-b

SOUS SECTION
  Le troisième • GAMMA {review: à vérifier}
`;

export interface FixtureOptions {
  page1?: string;
  page2?: string;
  spine?: string;
  idSalt?: string | null;
  allowUnsalted?: boolean;
  graphSlug?: string;
}

export function buildFixture(opts: FixtureOptions = {}): BuiltBook {
  const spine = parseSpine(opts.spine ?? SPINE, 'data/book/spine.dsa');
  const pages = [
    parsePage(opts.page1 ?? PAGE_1, 'data/book/pages/p001.dsa'),
    parsePage(opts.page2 ?? PAGE_2, 'data/book/pages/p002.dsa'),
  ];
  const { data, report } = buildGraphData(opts.graphSlug ?? FIXTURE_SLUG, spine, pages, {
    graphName: 'Graphe de test',
    sourceDocument: 'FIXTURE.pdf (hors dépôt)',
    idSalt: opts.idSalt === undefined ? FIXTURE_SALT : opts.idSalt,
    allowUnsalted: opts.allowUnsalted === true,
  });
  if (report.errors.length > 0) throw new Error(`fixture build errors: ${report.errors.map((e) => e.message).join('; ')}`);
  return { spine, pages, pageNumbers: [1, 2], data, report };
}

/** A database that already holds exactly what the book says. */
export function snapshotOf(data: GraphData): DbSnapshot {
  const rows = graphDataToRows(data);
  return {
    graph: { ...rows.graph },
    nodes: rows.nodes.map((n) => ({ ...n })),
    edges: rows.edges.map((e) => ({ ...e })),
    characters: rows.characters.map((c) => ({ ...c })),
  };
}

export const emptySnapshot = (): DbSnapshot => ({ graph: null, nodes: [], edges: [], characters: [] });

export const findNode = (rows: NodeRow[], key: string): NodeRow => {
  const row = rows.find((r) => r.node_key === key);
  if (!row) throw new Error(`no node ${key} in [${rows.map((r) => r.node_key).join(', ')}]`);
  return row;
};

export const findEdge = (rows: EdgeRow[], fromId: string, toId: string): EdgeRow => {
  const row = rows.find((r) => r.from_node_id === fromId && r.to_node_id === toId);
  if (!row) throw new Error('no such edge');
  return row;
};

export const findCharacter = (rows: CharacterRow[], name: string): CharacterRow => {
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`no character ${name}`);
  return row;
};

/** The whole-book key sets the planner needs to spot rows that disappeared. */
export const bookKeys = (data: GraphData) => ({
  nodeKeys: new Set(data.nodes.map((n) => n.nodeKey)),
  edgeIds: new Set(data.edges.map((e) => e.id)),
});
