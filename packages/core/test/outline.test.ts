// The picker's outline: the book's table of contents, not the graph's shape.
import { describe, expect, it } from 'vitest';
import { GraphIndex, bookOutline, findOutline, listSections, scopeCharacters } from '../src/index';
import type { OutlineSection, Section } from '../src/index';
import { mini } from './helpers';

const SPLITS = {
  ANCIEN: { yes: 'Ancien Testament', no: 'Nouveau Testament' },
  HOMME: { yes: 'Hommes', no: 'Femmes' },
};

function labels(rows: readonly OutlineSection[]): string[] {
  return rows.map((row) => row.label);
}

function row(rows: readonly OutlineSection[], label: string): OutlineSection {
  const found = rows.find((r) => r.label === label);
  if (!found) throw new Error(`no row ${label} in ${labels(rows).join(', ')}`);
  return found;
}

describe('the book outline', () => {
  it('names the two testaments instead of showing the ANCIEN question twice', () => {
    const { ix } = mini();
    const outline = bookOutline(listSections(ix), { splits: SPLITS });

    // The graph says « ANCIEN » with two children both called « HOMME ». The
    // book says Ancien and Nouveau.
    expect(labels(outline)).toEqual(['Ancien Testament', 'Nouveau Testament']);
    expect(row(outline, 'Ancien Testament').characters).toBe(10);
    expect(row(outline, 'Nouveau Testament').characters).toBe(3);
  });

  it('a NON carries on the same list, so its branch is a sibling, not a child', () => {
    const { ix } = mini();
    const outline = bookOutline(listSections(ix), { splits: SPLITS });

    // In the graph LIVRE DE SAMUEL hangs under PENTATEUQUE (answer NONONONON)
    // and LES ROIS under LIVRE DE SAMUEL (answer NON). In the book they are the
    // next entries of the same list.
    expect(labels(row(outline, 'Ancien Testament').children)).toEqual([
      'PENTATEUQUE',
      'LES 3 PREMIERS',
      'LIVRE DE SAMUEL',
      'LES ROIS',
      'LES 3 DERNIERS',
    ]);
  });

  it('counts only the names a row really holds, and the children add up', () => {
    const { ix } = mini();
    const outline = bookOutline(listSections(ix), { splits: SPLITS });
    const ancien = row(outline, 'Ancien Testament');

    // PENTATEUQUE keeps 6 names; the 4 it passed on belong to its siblings.
    expect(row(ancien.children, 'PENTATEUQUE').characters).toBe(6);
    expect(ancien.children.reduce((total, child) => total + child.characters, 0)).toBe(ancien.characters);
  });

  it('ticking a row scopes to exactly the names it shows', () => {
    const { ix } = mini();
    const sections = listSections(ix);
    const outline = bookOutline(sections, { splits: SPLITS });

    for (const label of ['Ancien Testament', 'Nouveau Testament']) {
      const picked = row(outline, label);
      expect(scopeCharacters(ix, picked.nodeIds)).toHaveLength(picked.characters);
    }

    const pentateuque = row(row(outline, 'Ancien Testament').children, 'PENTATEUQUE');
    const names = scopeCharacters(ix, pentateuque.nodeIds).map((c) => c.label);
    expect(names).toHaveLength(6);
    expect(names).toContain('ADAM');
    // The names of the sibling branches are not in it.
    expect(names).not.toContain('JOSUE');
    expect(names).not.toContain('DAVID');
  });

  it('never shows a name or a clue, and every row can be found by key', () => {
    const { ix } = mini();
    const outline = bookOutline(listSections(ix), { splits: SPLITS });
    const all: OutlineSection[] = [];
    const walk = (rows: readonly OutlineSection[]) => {
      for (const r of rows) {
        all.push(r);
        walk(r.children);
      }
    };
    walk(outline);

    for (const character of ix.playableCharacters()) {
      expect(all.map((r) => r.label)).not.toContain(character.label);
    }
    for (const r of all) expect(findOutline(outline, r.key)).toBe(r);
  });

  it('falls back to the plain tree when the server sends no answers', () => {
    const { ix } = mini();
    // A server that predates the outline: same rows, no answer labels.
    const old: Section[] = listSections(ix).map((section) => ({ ...section, answerLabel: null }));
    const outline = bookOutline(old, { splits: SPLITS });

    expect(labels(outline)).toEqual(['ANCIEN']);
    expect(labels(outline[0]?.children ?? [])).toEqual(['HOMME', 'HOMME']);
  });
});
