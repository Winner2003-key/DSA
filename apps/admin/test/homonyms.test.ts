import { describe, expect, it, beforeEach } from 'vitest';
import type { GraphData, GraphNode } from '@dsa/core';
import { computeDiff, summarize } from '../src/lib/diff';
import {
  filterHomonyms,
  findHomonyms,
  homonymStats,
  identicalKeys,
  isGenericClue,
  isWeakDescription,
  suggestDescription,
} from '../src/lib/homonyms';
import { buildTree } from '../src/lib/tree';
import { toGraphData, useEditorStore } from '../src/store/editor-store';
import { byLabel, miniGraph } from './helpers';

function jacques(data: GraphData): GraphNode[] {
  return data.nodes.filter((n) => n.label === 'JACQUES');
}

/** A second leaf for an existing person: same character, same name, under another parent. */
function addAliasLeaf(data: GraphData, of: GraphNode, label = of.label): GraphNode {
  const parent = byLabel(data, 'LES 3 PREMIERS');
  const leaf: GraphNode = { ...of, id: `${of.id}-bis`, nodeKey: `${parent.nodeKey}/bis`, label };
  data.nodes.push(leaf);
  data.edges.push({ ...data.edges[1]!, id: `${parent.id}->${leaf.id}`, fromNodeId: parent.id, toNodeId: leaf.id, orderIndex: 99 });
  return leaf;
}

describe('findHomonyms: grouping', () => {
  it('groups the two JACQUES of the mini graph as two people', () => {
    const groups = findHomonyms(miniGraph());
    expect(groups.map((g) => g.name)).toEqual(['JACQUES']);
    expect(groups[0]!.people.map((p) => p.node.question)).toEqual(["Fils d'Alphée", 'Fils de Zébédée']);
    expect(groups[0]!.people[0]!.path.map((n) => n.label)).toEqual(['DSA', 'ANCIEN', 'HOMME', 'LES EVANGILES', 'JACQUES']);
    expect(homonymStats(groups)).toMatchObject({ names: 1, people: 2, weak: 0, identical: 0, unresolved: 0 });
  });

  it('does not count aliases of one person (same character, several leaves)', () => {
    const data = miniGraph();
    const adam = byLabel(data, 'ADAM');
    const bis = addAliasLeaf(data, adam);
    expect(findHomonyms(data).map((g) => g.name)).toEqual(['JACQUES']);
    // … and the second leaf is kept with its person rather than lost
    const cain = byLabel(data, 'CAÏN');
    addAliasLeaf(data, { ...cain, id: 'other-adam', characterId: 'someone-else', label: 'Adam' });
    const adamGroup = findHomonyms(data).find((g) => g.key === 'adam')!;
    expect(adamGroup.people).toHaveLength(2);
    expect(adamGroup.people.find((p) => p.key === adam.characterId)!.otherNodes.map((n) => n.id)).toEqual([bis.id]);
  });

  it('compares names with normalizeName (case, accents, hyphens, spaces)', () => {
    const data = miniGraph();
    const cain = byLabel(data, 'CAÏN');
    addAliasLeaf(data, { ...cain, id: 'cain-2', characterId: 'another-cain' }, 'Ca-in');
    const group = findHomonyms(data).find((g) => g.key === 'cain')!;
    expect(group.name).toBe('CAÏN');
    expect(group.people).toHaveLength(2);
  });

  it('counts a leaf without a character as its own person', () => {
    const data = miniGraph();
    const esdras = byLabel(data, 'ESDRAS');
    addAliasLeaf(data, { ...esdras, id: 'esdras-2', characterId: null });
    expect(findHomonyms(data).find((g) => g.key === 'esdras')!.people).toHaveLength(2);
  });

  it('reads the card description from the character first, like dsa_get_my_secret', () => {
    const data = miniGraph();
    const [first] = jacques(data);
    data.characters.find((c) => c.id === first!.characterId)!.description = 'Le mineur · APÔTRE';
    const person = findHomonyms(data)[0]!.people.find((p) => p.node.id === first!.id)!;
    expect(person.description).toBe('Le mineur · APÔTRE');
  });
});

describe('weak descriptions', () => {
  it.each([
    '1er', '2ème', '2eme', '3e', 'Le 1er', 'LE PREMIER', 'La première', 'Le dernier', "L'aîné", 'le cadet',
    '2ème fils', 'Son père', 'Sa femme', 'SES FILS', 'Un frère', 'plus connu', 'moin connu', 'Moins connu', 'autre', '',
  ])('treats the clue %j as generic', (clue) => {
    expect(isGenericClue(clue)).toBe(true);
  });

  it.each(['Premier homme', 'Le meurtrier', "Fils d'Alphée", 'Serviteur de MOÏSE', 'Père de Noé', 'PÈRE DE LA FOI', 'Le 1er roi'])(
    'keeps the clue %j as meaningful',
    (clue) => {
      expect(isGenericClue(clue)).toBe(false);
    },
  );

  it('judges whole descriptions', () => {
    expect(isWeakDescription(null)).toBe(true);
    expect(isWeakDescription('   ')).toBe(true);
    expect(isWeakDescription('1er · SES FILS')).toBe(true);
    expect(isWeakDescription('plus connu · moins connu')).toBe(true);
    expect(isWeakDescription('1er · SES PETITS FILS · LIE A SEM')).toBe(false);
    expect(isWeakDescription("Fils d'Alphée · LES EVANGILES")).toBe(false);
    expect(isWeakDescription('Marcha avec DIEU')).toBe(false);
  });

  it('flags a weak person in a group and filters on it', () => {
    const data = miniGraph();
    const [first] = jacques(data);
    data.characters.find((c) => c.id === first!.characterId)!.description = '1er · LES EVANGILES';
    const groups = findHomonyms(data);
    expect(groups[0]!.people.map((p) => p.weak)).toEqual([true, false]);
    expect(filterHomonyms(groups, 'WEAK')).toHaveLength(1);
    expect(filterHomonyms(findHomonyms(miniGraph()), 'WEAK')).toHaveLength(0);
  });
});

describe('identical descriptions', () => {
  it('flags every person sharing a description, ignoring case, accents and punctuation', () => {
    expect([...identicalKeys([
      { key: 'a', description: 'Apôtre · LES EVANGILES' },
      { key: 'b', description: 'APOTRE - les évangiles' },
      { key: 'c', description: 'Frère de Jésus' },
    ])]).toEqual(['a', 'b']);
    expect(identicalKeys([{ key: 'a', description: null }, { key: 'b', description: '' }]).size).toBe(2);
    expect(identicalKeys([{ key: 'a', description: 'x' }, { key: 'b', description: 'y' }]).size).toBe(0);
  });

  it('marks both JACQUES once their descriptions match, and the filter finds them', () => {
    const data = miniGraph();
    for (const node of jacques(data)) data.characters.find((c) => c.id === node.characterId)!.description = 'Apôtre · LES EVANGILES';
    const groups = findHomonyms(data);
    expect(groups[0]!.people.every((p) => p.identical)).toBe(true);
    expect(homonymStats(groups)).toMatchObject({ identical: 2, unresolved: 2 });
    expect(filterHomonyms(groups, 'IDENTICAL')).toHaveLength(1);
    expect(filterHomonyms(groups, 'ALL', 'jacq')).toHaveLength(1);
    expect(filterHomonyms(groups, 'ALL', 'adam')).toHaveLength(0);
  });
});

describe('suggestDescription', () => {
  it('builds clue · parent · grandparent from the book path', () => {
    const data = miniGraph();
    const tree = buildTree(data.nodes, data.edges);
    const [first] = jacques(data);
    expect(suggestDescription(tree, first!.id)).toBe("Fils d'Alphée · LES EVANGILES · HOMME");
    expect(suggestDescription(tree, byLabel(data, 'JEROBOAM').id)).toBe('LE PREMIER · LES ROIS · LIVRE DE SAMUEL');
  });

  it('skips GROUP ancestors (CLASSE, TOME) and START', () => {
    const data = miniGraph();
    const tree = buildTree(data.nodes, data.edges);
    expect(suggestDescription(tree, byLabel(data, 'CAÏN').id)).toBe('Le meurtrier · LIE A ADAM · PENTATEUQUE (HOMMES)');
    expect(suggestDescription(tree, byLabel(data, 'ISAAC').id)).toBe('FILS DE LA PROMESSE · LIE A ABRAHAM · PENTATEUQUE (HOMMES)');
  });

  it('uses the ALIAS group label as the clue, not the qualifier', () => {
    const data = miniGraph();
    const tree = buildTree(data.nodes, data.edges);
    expect(suggestDescription(tree, byLabel(data, 'ABRAM').id)).toBe('PÈRE DE LA FOI · LIE A ABRAHAM · PENTATEUQUE (HOMMES)');
  });

  it('matches the brief example shape', () => {
    const data = miniGraph();
    const sem = byLabel(data, 'LIE A ADAM');
    const tree = buildTree(
      [
        ...data.nodes,
        { ...sem, id: 'petits', nodeKey: 'petits', label: 'SES PETITS FILS' },
        { ...byLabel(data, 'ADAM'), id: 'leaf', nodeKey: 'leaf', label: 'ASSUR', question: '1er' },
      ],
      [...data.edges, { ...data.edges[1]!, id: 'e1', fromNodeId: sem.id, toNodeId: 'petits' }, { ...data.edges[1]!, id: 'e2', fromNodeId: 'petits', toNodeId: 'leaf' }],
    );
    expect(suggestDescription(tree, 'leaf')).toBe('1er · SES PETITS FILS · LIE A ADAM');
  });
});

describe('editing a card description', () => {
  const store = () => useEditorStore.getState();
  beforeEach(() => store().load(miniGraph()));

  it('produces a diff with the description and the flag on the character and its node', () => {
    const [first] = jacques(miniGraph());
    store().setCardDescription(first!.id, "Fils d'Alphée · LES EVANGILES · APÔTRE");
    const diff = computeDiff(store().baseline!, toGraphData(store().present!));

    expect(diff.characters.updated).toHaveLength(1);
    const character = diff.characters.updated[0]!;
    expect(character.changed).toEqual(['description', 'metadata']);
    expect(character.after.description).toBe("Fils d'Alphée · LES EVANGILES · APÔTRE");
    expect(character.after.metadata).toMatchObject({ description_edited: true, node_key: first!.nodeKey });

    expect(diff.nodes.updated).toHaveLength(1);
    const node = diff.nodes.updated[0]!;
    expect(node.changed).toEqual(['description', 'metadata']);
    expect(node.after.description).toBe(character.after.description);
    expect(node.after.metadata.description_edited).toBe(true);

    expect(summarize(diff)).toMatchObject({ total: 2, charactersUpdated: 1, nodesUpdated: 1 });
    expect(diff.edges.updated).toHaveLength(0);
  });

  it('keeps every leaf of the same person in sync, and typing is one undo step', () => {
    const data = miniGraph();
    const abram = byLabel(data, 'ABRAM');
    const abraham = byLabel(data, 'ABRAHAM');
    for (const text of ['P', 'Pè', 'Père des croyants']) store().setCardDescription(abram.id, text, `description:${abram.id}`);
    const nodes = store().present!.nodes;
    expect(nodes.find((n) => n.id === abraham.id)!.description).toBe('Père des croyants');
    expect(nodes.find((n) => n.id === abram.id)!.description).toBe('Père des croyants');
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().present!.characters.find((c) => c.id === abram.characterId)!.description).toBe('PÈRE DE LA FOI · LIE A ABRAHAM');
  });

  it('stores an emptied field as null', () => {
    const [first] = jacques(miniGraph());
    store().setCardDescription(first!.id, '  ');
    expect(store().present!.characters.find((c) => c.id === first!.characterId)!.description).toBeNull();
  });
});
