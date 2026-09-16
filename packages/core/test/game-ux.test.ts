// GRAPH_SPECIFICATION.md §8: homonyms and the path fields the book-like graph needs.
import { describe, expect, it } from 'vitest';
import { GraphIndex, hasHomonyms } from '../src/index';
import type { GraphData, PathStep } from '../src/index';
import { KEYS, mini, playAll } from './helpers';

const TO_PENTATEUQUE_OUI: [string, string][] = [
  ['ANCIEN', 'OUI'],
  ['HOMME', 'OUI'],
  ['PENTATEUQUE', 'OUI'],
];

const fields = (path: PathStep[]) =>
  path.flatMap((p) => (p.kind === 'STEP' ? [[p.text, p.promptKind, p.nodeType, p.targetText]] : []));

describe('hasHomonyms', () => {
  it('is true for the two JACQUES, who are different people', () => {
    const { ix, id } = mini();
    expect(hasHomonyms(ix, id(KEYS.jacquesAlphee))).toBe(true);
    expect(hasHomonyms(ix, id(KEYS.jacquesZebedee))).toBe(true);
  });

  it('is false for a unique name (CAÏN) and for an unknown node', () => {
    const { ix, id } = mini();
    expect(hasHomonyms(ix, id(KEYS.cain))).toBe(false);
    expect(hasHomonyms(ix, 'nope')).toBe(false);
  });

  it('is false for ABRAHAM and ABRAM, one person', () => {
    const { ix, id } = mini();
    expect(hasHomonyms(ix, id(KEYS.abraham))).toBe(false);
    expect(hasHomonyms(ix, id(KEYS.abram))).toBe(false);
  });

  it('compares character ids, not labels only, and ignores unplayable nodes', () => {
    const { data, id } = mini();
    const abram = data.nodes.find((n) => n.nodeKey === KEYS.abram)!;
    const group = data.edges.find((e) => e.toNodeId === abram.id)!.fromNodeId;
    const withExtra = (characterId: string | null, reviewStatus: 'APPROVED' | 'NEEDS_REVIEW'): GraphData => ({
      ...data,
      nodes: [...data.nodes, { ...abram, id: 'extra', nodeKey: 'extra', label: 'Abram', characterId, reviewStatus }],
      edges: [...data.edges, { ...data.edges[0]!, id: 'extra-edge', fromNodeId: group, toNodeId: 'extra', edgeKind: 'HIERARCHY', answerLabel: 'OUI', orderIndex: 99 }],
    });
    const cain = data.nodes.find((n) => n.nodeKey === KEYS.cain)!;
    expect(hasHomonyms(new GraphIndex(withExtra(abram.characterId, 'APPROVED')), id(KEYS.abram))).toBe(false);
    expect(hasHomonyms(new GraphIndex(withExtra(cain.characterId, 'APPROVED')), id(KEYS.abram))).toBe(true);
    expect(hasHomonyms(new GraphIndex(withExtra(cain.characterId, 'NEEDS_REVIEW')), id(KEYS.abram))).toBe(false);
  });
});

describe('revealedPath: nodeType and targetText', () => {
  it('scenario 1 (CAÏN): spine steps name the node entered, child steps do not', () => {
    const { engine, id } = mini();
    const s = playAll(engine, engine.newGame(id(KEYS.cain)), [
      ...TO_PENTATEUQUE_OUI,
      ['LIE A ADAM', 'OUI'],
      ['CLASSE 1', 'OUI'],
      ['Premier homme', 'NON'],
      ['Le meurtrier', 'OUI'],
    ]);
    expect(fields(engine.revealedPath(s))).toEqual([
      ['ANCIEN', 'SPINE', 'QUESTION', 'HOMME'],
      ['HOMME', 'SPINE', 'QUESTION', 'PENTATEUQUE'],
      ['PENTATEUQUE', 'SPINE', 'QUESTION', 'PENTATEUQUE (HOMMES)'],
      ['LIE A ADAM', 'CHILD', 'CATEGORY', null],
      ['CLASSE 1', 'CHILD', 'GROUP', null],
      ['Premier homme', 'CHILD', 'CHARACTER', null],
      ['Le meurtrier', 'CHILD', 'CHARACTER', null],
    ]);
  });

  it('scenario 4 (DAVID): OUIOUIOUI at LIVRE DE SAMUEL enters LIE A DAVID', () => {
    const { engine, id } = mini();
    const s = playAll(engine, engine.newGame(id(KEYS.david)), [
      ['ANCIEN', 'OUI'],
      ['HOMME', 'OUI'],
      ['PENTATEUQUE', 'NONONO'],
      ['LIVRE DE SAMUEL', 'OUI OUI'],
      ["fils d'isaï", 'OUI'],
    ]);
    const path = fields(engine.revealedPath(s));
    expect(path[2]).toEqual(['PENTATEUQUE', 'SPINE', 'QUESTION', 'LIVRE DE SAMUEL']);
    expect(path[3]).toEqual(['LIVRE DE SAMUEL', 'SPINE', 'QUESTION', 'LIE A DAVID']);
    expect(path[4]).toEqual(["fils d'isaï", 'CHILD', 'CHARACTER', null]);
  });
});
