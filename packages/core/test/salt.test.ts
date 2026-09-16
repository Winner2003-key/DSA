import { describe, expect, it } from 'vitest';
import {
  UNSALTED_GRAPH_SLUGS,
  assertIdSalt,
  buildGraphData,
  characterId,
  edgeId,
  graphId,
  idPrefix,
  isUnsaltedGraph,
  nodeId,
  parsePage,
  parseSpine,
} from '../src/index';
import type { GraphData } from '../src/index';
import { mini } from './helpers';

const SALT = '3f6b1c2a-9d4e-4f70-8b1a-2c5d7e9f0a13';
const OTHER_SALT = 'c0ffee00-1111-2222-3333-444455556666';

const SPINE = `START DSA
  DÉBUT -> QUESTION ANCIEN @p2
    OUI -> CATEGORY SECTION A @p8
`;
const PAGE = `@page 8
@attach ancien[oui]/section-a

CLASSE X {classe}
  Le premier • ALPHA
  plus connu • BETA {same-as: ancien[oui]/section-a/classe-x/le-premier--alpha}
`;

function build(slug: string, opts: { idSalt?: string | null; allowUnsalted?: boolean }): GraphData {
  const { data, report } = buildGraphData(slug, parseSpine(SPINE, 'spine.dsa'), [parsePage(PAGE, 'p008.dsa')], {
    defaultReviewStatus: 'APPROVED',
    ...opts,
  });
  expect(report.errors).toEqual([]);
  return data;
}

describe('id salt (GRAPH_SPECIFICATION §7)', () => {
  it('leaves the unsalted test graph alone, with or without a salt', () => {
    expect(UNSALTED_GRAPH_SLUGS).toEqual(['mini']);
    expect(isUnsaltedGraph('mini')).toBe(true);
    expect(isUnsaltedGraph('livre')).toBe(false);
    expect(idPrefix('mini')).toBe('mini:');
    expect(idPrefix('mini', { salt: SALT })).toBe('mini:');

    // The committed fixture ids must never move.
    expect(nodeId('mini', 'dsa')).toBe('745fb64b-de61-5a63-b6c9-8ea8ca520f74');
    expect(nodeId('mini', 'dsa', { salt: SALT })).toBe('745fb64b-de61-5a63-b6c9-8ea8ca520f74');
    expect(edgeId('mini', 'dsa', 'ancien', { salt: SALT })).toBe('26622408-81fe-5975-a944-f3f3e4bfe59a');
    expect(characterId('mini', 'x', { salt: SALT })).toBe(characterId('mini', 'x'));

    const built = mini().data;
    expect(built.nodes.find((n) => n.nodeKey === 'dsa')?.id).toBe('745fb64b-de61-5a63-b6c9-8ea8ca520f74');
  });

  it('salts real graphs: graphSlug:salt:key', () => {
    expect(idPrefix('livre', { salt: SALT })).toBe(`livre:${SALT}:`);
    expect(nodeId('livre', 'ancien', { salt: SALT })).not.toBe(nodeId('livre', 'ancien', { allowUnsalted: true }));
    expect(nodeId('livre', 'ancien', { salt: SALT })).not.toBe(nodeId('livre', 'ancien', { salt: OTHER_SALT }));
    expect(edgeId('livre', 'a', 'b', { salt: SALT })).not.toBe(edgeId('livre', 'a', 'b', { allowUnsalted: true }));
    expect(characterId('livre', 'a', { salt: SALT })).not.toBe(characterId('livre', 'a', { allowUnsalted: true }));
    // A salted id is still a plain UUID v5 of the salted name, so it is not guessable from the key alone.
    expect(nodeId('livre', 'ancien', { salt: SALT })).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is deterministic for the same salt', () => {
    expect(nodeId('livre', 'ancien', { salt: SALT })).toBe(nodeId('livre', 'ancien', { salt: SALT }));
    const a = build('livre', { idSalt: SALT });
    const b = build('livre', { idSalt: SALT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('refuses to build a real graph without a salt', () => {
    expect(() => nodeId('livre', 'ancien')).toThrow(/needs an id salt/);
    expect(() => edgeId('livre', 'a', 'b')).toThrow(/needs an id salt/);
    expect(() => characterId('livre', 'a')).toThrow(/needs an id salt/);
    expect(() => assertIdSalt('livre')).toThrow(/DSA_ID_SALT/);
    expect(() => assertIdSalt('livre', { salt: '' })).toThrow(/DSA_ID_SALT/);
    expect(() => assertIdSalt('livre', { salt: null })).toThrow(/DSA_ID_SALT/);
    expect(() => buildGraphData('livre', parseSpine(SPINE, 'spine.dsa'), [])).toThrow(/needs an id salt/);
    // …and says so even when the transcription is empty.
    expect(() => buildGraphData('livre', parseSpine('', 'spine.dsa'), [])).toThrow(/needs an id salt/);
    expect(() => assertIdSalt('livre', { allowUnsalted: true })).not.toThrow();
    expect(() => assertIdSalt('mini')).not.toThrow();
  });

  it('buildGraphData({ idSalt }) changes every row id but nothing else', () => {
    const plain = build('livre', { allowUnsalted: true });
    const salted = build('livre', { idSalt: SALT });

    expect(salted.graph.id).toBe(plain.graph.id);
    expect(salted.graph.id).toBe(graphId('livre'));
    expect(salted.nodes.map((n) => n.nodeKey)).toEqual(plain.nodes.map((n) => n.nodeKey));
    expect(salted.characters.map((c) => c.name)).toEqual(plain.characters.map((c) => c.name));
    expect(salted.nodes.length).toBeGreaterThan(3);
    expect(salted.characters.length).toBe(1);

    for (const [i, n] of salted.nodes.entries()) {
      expect(n.id, n.nodeKey).not.toBe(plain.nodes[i]?.id);
      expect(n.id).toBe(nodeId('livre', n.nodeKey, { salt: SALT }));
    }
    for (const [i, e] of salted.edges.entries()) expect(e.id).not.toBe(plain.edges[i]?.id);
    for (const [i, c] of salted.characters.entries()) expect(c.id).not.toBe(plain.characters[i]?.id);

    // Ids stay internally consistent: edges and character links point at the salted rows.
    const ids = new Set(salted.nodes.map((n) => n.id));
    for (const e of salted.edges) {
      expect(ids.has(e.fromNodeId) && ids.has(e.toNodeId), e.answerLabel).toBe(true);
      expect(e.graphId).toBe(salted.graph.id);
    }
    const characterIds = new Set(salted.characters.map((c) => c.id));
    for (const n of salted.nodes) if (n.characterId !== null) expect(characterIds.has(n.characterId)).toBe(true);
    // The alias leaf shares the primary leaf's character row.
    expect(new Set(salted.nodes.filter((n) => n.nodeType === 'CHARACTER').map((n) => n.characterId)).size).toBe(1);
  });
});
