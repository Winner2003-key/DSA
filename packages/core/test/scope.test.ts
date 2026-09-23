import { describe, expect, it } from 'vitest';
import { GraphIndex, checkScope, listSections, normalizeScope, scopeCharacters, scopeLabels, sectionIds } from '../src/index';
import { KEYS, mini } from './helpers';

const P = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes';

describe('practising a part of the book (scope)', () => {
  it('lists every section with its number of names, and no leaf', () => {
    const { ix } = mini();
    const sections = listSections(ix);
    const labels = sections.map((s) => s.label);

    // Every non-CHARACTER node is there, including the spine questions.
    expect(labels).toContain('DSA');
    expect(labels).toContain('ANCIEN');
    expect(labels).toContain('PENTATEUQUE (HOMMES)');
    expect(labels).toContain('CLASSE 1');
    expect(labels).toContain('LES EVANGILES');
    // And not one name or clue.
    for (const character of ix.playableCharacters()) {
      expect(labels).not.toContain(character.label);
      expect(sections.map((s) => s.nodeId)).not.toContain(character.id);
    }

    const by = (label: string) => sections.find((s) => s.label === label);
    expect(by('DSA')).toMatchObject({ parentId: null, depth: 0, characters: 13 });
    expect(by('CLASSE 1')).toMatchObject({ characters: 2 });
    expect(by('LIE A ADAM')).toMatchObject({ characters: 2 });
    expect(by('LIE A ABRAHAM')).toMatchObject({ characters: 4 });
    expect(by('LES EVANGILES')).toMatchObject({ characters: 3 });
  });

  it('the tree hangs together: every parent is a section, deeper than its child is not', () => {
    const { ix } = mini();
    const sections = listSections(ix);
    const ids = sectionIds(ix);
    const byId = new Map(sections.map((s) => [s.nodeId, s]));
    const roots = sections.filter((s) => s.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.label).toBe('DSA');
    for (const s of sections) {
      if (s.parentId === null) continue;
      expect(ids.has(s.parentId)).toBe(true);
      expect(byId.get(s.parentId)?.depth).toBe(s.depth - 1);
      // A parent always holds at least as many names as its child.
      expect(byId.get(s.parentId)?.characters ?? 0).toBeGreaterThanOrEqual(s.characters);
    }
  });

  it('draws only inside the scope, and an empty scope is the whole book', () => {
    const { ix, id } = mini();
    const names = (scope: string[] | null) => scopeCharacters(ix, scope).map((c) => c.label);

    expect(names(null)).toHaveLength(13);
    expect(names([])).toHaveLength(13);
    expect(names([id(`${P}/lie-a-adam`)])).toEqual(['ADAM', 'CAÏN']);
    expect(names([id(`${P}/lie-a-adam/classe-1`)])).toEqual(['ADAM', 'CAÏN']);
    expect(names([id('ancien[non]/homme[oui]/les-evangiles')])).toEqual(['JESUS-CHRIST', 'JACQUES', 'JACQUES']);
    // A spine question is a section too: "the Nouveau Testament".
    expect(names([id('ancien[non]/homme')])).toEqual(['JESUS-CHRIST', 'JACQUES', 'JACQUES']);
  });

  it('several sections make one union, in book order and without duplicates', () => {
    const { ix, id } = mini();
    const union = scopeCharacters(ix, [
      id('ancien[non]/homme[oui]/les-evangiles'),
      id(`${P}/lie-a-adam`),
      // Overlapping on purpose: CLASSE 1 is already inside LIE A ADAM.
      id(`${P}/lie-a-adam/classe-1`),
    ]).map((c) => c.label);
    expect(union).toEqual(['ADAM', 'CAÏN', 'JESUS-CHRIST', 'JACQUES', 'JACQUES']);
  });

  it('a scope down to a single name still works', () => {
    const { ix, id } = mini();
    const alone = scopeCharacters(ix, [id('ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers')]);
    expect(alone.map((c) => c.label)).toEqual(['ESDRAS']);
    expect(checkScope(ix, [id('ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers')])).toBeNull();
  });

  it('refuses an unknown section, a name used as a section, and an empty union', () => {
    const { ix, id } = mini();
    expect(checkScope(ix, null)).toBeNull();
    expect(checkScope(ix, [])).toBeNull();

    expect(checkScope(ix, ['6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a'])?.code).toBe('INVALID_SETTINGS');
    // A CHARACTER node is not a section, even though it is in the graph.
    expect(checkScope(ix, [id(KEYS.cain)])?.code).toBe('INVALID_SETTINGS');
    // A section of a graph the player is not playing is unknown here too.
    expect(checkScope(ix, [id(`${P}/lie-a-adam`), id(KEYS.david)])?.code).toBe('INVALID_SETTINGS');
  });

  it('an empty union is NO_PLAYABLE_SECRET, not INVALID_SETTINGS', () => {
    const { data, id } = mini();
    // Un-approve the two names of CLASSE 1: the section is still a section, but holds nothing.
    const stripped = {
      ...data,
      nodes: data.nodes.map((n) =>
        n.nodeKey === `${P}/lie-a-adam/classe-1/premier-homme--adam` || n.nodeKey === `${P}/lie-a-adam/classe-1/le-meurtrier--cain`
          ? { ...n, reviewStatus: 'REJECTED' as const }
          : n,
      ),
    };
    const ix = new GraphIndex(stripped);
    const classe1 = id(`${P}/lie-a-adam/classe-1`);
    expect(scopeCharacters(ix, [classe1])).toEqual([]);
    expect(checkScope(ix, [classe1])?.code).toBe('NO_PLAYABLE_SECRET');
  });

  it('normalizes a scope and names the chosen sections in book order', () => {
    const { ix, id } = mini();
    const evangiles = id('ancien[non]/homme[oui]/les-evangiles');
    const adam = id(`${P}/lie-a-adam`);

    expect(normalizeScope(null)).toEqual([]);
    expect(normalizeScope([adam, adam])).toEqual([adam]);
    expect(normalizeScope([evangiles, adam])).toEqual([evangiles, adam].sort());

    // Stored order does not matter: the labels always come back in book order.
    expect(scopeLabels(ix, [evangiles, adam])).toEqual(['LIE A ADAM', 'LES EVANGILES']);
    expect(scopeLabels(ix, [adam, evangiles])).toEqual(['LIE A ADAM', 'LES EVANGILES']);
    expect(scopeLabels(ix, [])).toEqual([]);
  });
});
