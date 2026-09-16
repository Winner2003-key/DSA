import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MINI_JSON, serializeGraph } from '../scripts/load-book';
import type { GraphNode } from '../src/index';
import { E, P, S, mini } from './helpers';

// docs/sessions/mini-graph-fixture.md, "Nodes" table, in order.
const NODES: [string, string, string, string | null, string | null][] = [
  ['dsa', 'START', 'DSA', null, null],
  ['ancien', 'QUESTION', 'ANCIEN', null, null],
  ['ancien[oui]/homme', 'QUESTION', 'HOMME', null, null],
  ['ancien[oui]/homme[oui]/pentateuque', 'QUESTION', 'PENTATEUQUE', null, null],
  [P, 'CATEGORY', 'PENTATEUQUE (HOMMES)', null, null],
  [`${P}/lie-a-adam`, 'CATEGORY', 'LIE A ADAM', null, null],
  [`${P}/lie-a-adam/classe-1`, 'GROUP', 'CLASSE 1', null, 'CLASSE'],
  [`${P}/lie-a-adam/classe-1/premier-homme--adam`, 'CHARACTER', 'ADAM', 'Premier homme', null],
  [`${P}/lie-a-adam/classe-1/le-meurtrier--cain`, 'CHARACTER', 'CAÏN', 'Le meurtrier', null],
  [`${P}/lie-a-abraham`, 'CATEGORY', 'LIE A ABRAHAM', null, null],
  [`${P}/lie-a-abraham/pere-de-la-foi`, 'GROUP', 'PÈRE DE LA FOI', null, 'ALIAS'],
  [`${P}/lie-a-abraham/pere-de-la-foi/plus-connu--abraham`, 'CHARACTER', 'ABRAHAM', 'plus connu', null],
  [`${P}/lie-a-abraham/pere-de-la-foi/moin-connu--abram`, 'CHARACTER', 'ABRAM', 'moin connu', null],
  [`${P}/lie-a-abraham/tome-1`, 'GROUP', 'TOME 1', null, 'TOME'],
  [`${P}/lie-a-abraham/tome-1/fils-d-agar--ismael`, 'CHARACTER', 'ISMAËL', "FILS D'AGAR", null],
  [`${P}/lie-a-abraham/tome-1/fils-de-la-promesse--isaac`, 'CHARACTER', 'ISAAC', 'FILS DE LA PROMESSE', null],
  ['ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers', 'CATEGORY', 'LES 3 PREMIERS', null, null],
  ['ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue', 'CHARACTER', 'JOSUE', 'Serviteur de MOÏSE', null],
  [S, 'QUESTION', 'LIVRE DE SAMUEL', null, null],
  [`${S}[ouioui]/lie-a-david`, 'CATEGORY', 'LIE A DAVID', null, null],
  [`${S}[ouioui]/lie-a-david/fils-d-isai--david`, 'CHARACTER', 'DAVID', "fils d'isaï", null],
  [`${S}[non]/les-rois`, 'CATEGORY', 'LES ROIS', null, null],
  [`${S}[non]/les-rois/le-premier--jeroboam`, 'CHARACTER', 'JEROBOAM', 'LE PREMIER', null],
  ['ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers', 'CATEGORY', 'LES 3 DERNIERS', null, null],
  ['ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers/verse-dans-les-ecritures--esdras', 'CHARACTER', 'ESDRAS', 'VERSÉ DANS LES ÉCRITURES', null],
  ['ancien[non]/homme', 'QUESTION', 'HOMME', null, null],
  [E, 'CATEGORY', 'LES EVANGILES', null, null],
  [`${E}/le-sauveur--jesus-christ`, 'CHARACTER', 'JESUS-CHRIST', 'le sauveur', null],
  [`${E}/fils-d-alphee--jacques`, 'CHARACTER', 'JACQUES', "Fils d'Alphée", null],
  [`${E}/fils-de-zebedee--jacques`, 'CHARACTER', 'JACQUES', 'Fils de Zébédée', null],
];

// "DECISION / SYSTEM edges (in order)" table.
const L3D = 'ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers';
const L3P = 'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers';
const PENT = 'ancien[oui]/homme[oui]/pentateuque';
const SPINE_EDGES: [string, string, string, string][] = [
  ['dsa', 'ancien', 'SYSTEM', 'DÉBUT'],
  ['ancien', 'ancien[oui]/homme', 'DECISION', 'OUI'],
  ['ancien', 'ancien[non]/homme', 'DECISION', 'NON'],
  ['ancien[oui]/homme', PENT, 'DECISION', 'OUI'],
  ['ancien[oui]/homme', L3D, 'DECISION', 'JE NE SAIS PAS'],
  [PENT, P, 'DECISION', 'OUI'],
  [PENT, L3P, 'DECISION', 'NON'],
  [PENT, S, 'DECISION', 'NONONONON'],
  [S, `${S}[ouioui]/lie-a-david`, 'DECISION', 'OUIOUIOUI'],
  [S, `${S}[non]/les-rois`, 'DECISION', 'NON'],
  ['ancien[non]/homme', E, 'DECISION', 'OUI'],
];

describe('mini fixture', () => {
  const { data, ix, report } = mini();
  const keyOf = (id: string) => (data.nodes.find((n) => n.id === id) as GraphNode).nodeKey;

  it('builds without errors or warnings', () => {
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(data.graph).toMatchObject({ slug: 'mini', status: 'PUBLISHED' });
    expect(data.nodes.every((n) => n.reviewStatus === 'APPROVED')).toBe(true);
    expect(data.edges.every((e) => e.reviewStatus === 'APPROVED')).toBe(true);
  });

  it('has exactly the node keys, types, labels and questions of the table, in order', () => {
    expect(data.nodes.map((n) => [n.nodeKey, n.nodeType, n.label, n.question, n.metadata.group_kind ?? null])).toEqual(NODES);
  });

  it('has exactly the DECISION/SYSTEM edges with labels and order', () => {
    const orderOf = new Map<string, number>();
    const expected = SPINE_EDGES.map(([from, to, kind, label]) => {
      const order = orderOf.get(from) ?? 0;
      orderOf.set(from, order + 1);
      return [from, to, kind, label, order];
    });
    const actual = data.edges.filter((e) => e.edgeKind !== 'HIERARCHY').map((e) => [keyOf(e.fromNodeId), keyOf(e.toNodeId), e.edgeKind, e.answerLabel, e.orderIndex]);
    const sort = (rows: (string | number)[][]) => [...rows].sort((a, b) => `${a[0]}|${a[4]}`.localeCompare(`${b[0]}|${b[4]}`));
    expect(sort(actual)).toEqual(sort(expected));
    const variants = (from: string, to: string) => data.edges.find((e) => keyOf(e.fromNodeId) === from && keyOf(e.toNodeId) === to)?.metadata.source_variants;
    expect(variants(PENT, S)).toEqual([{ label: 'NONONONO', page: 27 }]);
    expect(variants(S, `${S}[ouioui]/lie-a-david`)).toEqual([{ label: 'OUIOUIOUIOUI', page: 32 }]);
  });

  it('has HIERARCHY edges labelled OUI, ordered as listed under each parent', () => {
    const keys = new Set(NODES.map((n) => n[0]));
    const expectedChildren = new Map<string, string[]>();
    for (const [key] of NODES) {
      const parent = key.slice(0, key.lastIndexOf('/'));
      if (keys.has(parent)) expectedChildren.set(parent, [...(expectedChildren.get(parent) ?? []), key]);
    }
    const hierarchy = data.edges.filter((e) => e.edgeKind === 'HIERARCHY');
    expect(hierarchy.every((e) => e.answerLabel === 'OUI')).toBe(true);
    expect(hierarchy).toHaveLength([...expectedChildren.values()].flat().length);
    for (const [parent, children] of expectedChildren) {
      expect(ix.outgoing((ix.nodeByKey(parent) as GraphNode).id).map((e) => keyOf(e.toNodeId))).toEqual(children);
    }
  });

  it('has one character per CHARACTER node except ABRAHAM/ABRAM, with generated descriptions', () => {
    expect(data.characters).toHaveLength(12);
    const abraham = ix.nodeByKey(`${P}/lie-a-abraham/pere-de-la-foi/plus-connu--abraham`) as GraphNode;
    const abram = ix.nodeByKey(`${P}/lie-a-abraham/pere-de-la-foi/moin-connu--abram`) as GraphNode;
    expect(abram.characterId).toBe(abraham.characterId);
    expect(ix.characterOf(abraham.id)).toMatchObject({ name: 'ABRAHAM', aliases: ['ABRAM'], gender: null, testament: null });
    expect(abram.metadata.qualifier).toBe('moin connu');
    const jacques = data.characters.filter((c) => c.name === 'JACQUES').map((c) => c.description);
    expect(jacques).toEqual(["Fils d'Alphée · LES EVANGILES", 'Fils de Zébédée · LES EVANGILES']);
    expect(ix.characterOf((ix.nodeByKey(`${P}/lie-a-adam/classe-1/le-meurtrier--cain`) as GraphNode).id)?.description).toBe('Le meurtrier · LIE A ADAM');
  });

  it('matches the committed fixtures/mini-graph.json (run npm run fixtures after changing fixtures/mini)', () => {
    expect(readFileSync(MINI_JSON, 'utf8')).toBe(serializeGraph(data));
  });
});
