// The book's table of contents, as a player reads it (GRAPH_SPECIFICATION §2,
// "scope"). `listSections` returns the graph as it is: a chain of questions,
// where « ANCIEN » is a *question* whose two answers are the two testaments and
// where a "NON" simply carries on down the same list. A picker built straight
// from it shows « ANCIEN » with two children both called « HOMME », which is the
// graph talking, not the book.
//
// `bookOutline` turns those rows into the outline printed in the book itself:
//
//   ANCIEN                      NOUVEAU
//     HOMME                       HOMME
//       PENTATEUQUE                 EVANGILES
//       LES 3 PREMIERS              ACTES DES APOTRES
//       LIVRE DE SAMUEL             …
//       …                         FEMME
//     FEMME
//
// Three rules do it, and all three come from the book's own grammar:
//
//  1. A **split** question (ANCIEN, HOMME) is not a part of the book — its two
//     sides are. The question disappears and leaves two named branches.
//  2. A branch entered with a **NON** continues the list its question belongs
//     to, so it is a *sibling* of that question, not a child of it.
//  3. A question with a single branch left **is** that branch: the two are shown
//     as one row.
//
// Nothing here knows a name or a clue: it only rearranges labels and counts.

import { answerClass } from './answers';
import type { Section } from './scope';

/** What the two sides of a split question are called. */
export interface OutlineSplit {
  /** OUI, OUIOUIOUI, JE NE SAIS PAS — everything that is not a NON. */
  yes: string;
  /** NON and NONONONON. */
  no: string;
}

/**
 * The questions that split the book in two rather than open a list. Keyed by
 * the question's label, as the book prints it. The app passes its own French
 * wording; these are the fallback.
 */
export const BOOK_SPLITS: Record<string, OutlineSplit> = {
  ANCIEN: { yes: 'ANCIEN', no: 'NOUVEAU' },
  HOMME: { yes: 'HOMME', no: 'FEMME' },
};

/** One row of the picker. */
export interface OutlineSection {
  /** Stable row key; a side of a split question has no node of its own. */
  key: string;
  label: string;
  /**
   * What ticking this row puts in `settings.scope`. Usually one section, and
   * more only for a side of a split question that the book spreads over several
   * branches (the men of the Ancien Testament are three of them).
   */
  nodeIds: string[];
  /** Playable names underneath, counted once. */
  characters: number;
  children: OutlineSection[];
}

export interface OutlineOptions {
  /** Question label → the names of its two sides. Defaults to `BOOK_SPLITS`. */
  splits?: Record<string, OutlineSplit>;
}

function isNo(answerLabel: string | null): boolean {
  if (!answerLabel) return false;
  const kind = answerClass(answerLabel);
  return kind === 'NON' || kind === 'NON_REPETE';
}

function sum(sections: readonly Section[]): number {
  return sections.reduce((total, section) => total + section.characters, 0);
}

/**
 * The book's outline, in book order, from the flat rows of `listSections` (or of
 * `dsa_list_sections`, which returns the same shape).
 *
 * A server that predates the outline sends no answer at all; the rows are then
 * shown as they come, which is what the picker did before.
 */
export function bookOutline(sections: readonly Section[], options: OutlineOptions = {}): OutlineSection[] {
  const known = sections.some((section) => section.answerLabel !== null);
  const splits = known ? (options.splits ?? BOOK_SPLITS) : {};

  const childrenOf = new Map<string, Section[]>();
  const roots: Section[] = [];
  for (const section of sections) {
    if (section.parentId === null) roots.push(section);
    else {
      const siblings = childrenOf.get(section.parentId);
      if (siblings) siblings.push(section);
      else childrenOf.set(section.parentId, [section]);
    }
  }

  const walked = new Set<string>();

  /** The rows that stand in for `section` at the level of its parent. */
  const expand = (section: Section): OutlineSection[] => {
    if (walked.has(section.nodeId)) return [];
    walked.add(section.nodeId);

    const children = childrenOf.get(section.nodeId) ?? [];
    // Rule 2: only a question answers NON. Under a CATEGORY every edge is a
    // hierarchy edge, so `no` is empty there and nothing is hoisted.
    const yes = known ? children.filter((child) => !isNo(child.answerLabel)) : children;
    const no = known ? children.filter((child) => isNo(child.answerLabel)) : [];

    // Rule 1: a split question is two named branches, and no row of its own.
    const split = section.nodeType === 'QUESTION' ? splits[section.label] : undefined;
    if (split) {
      return [side(`${section.nodeId}:oui`, split.yes, yes), side(`${section.nodeId}:non`, split.no, no)].filter(
        (row): row is OutlineSection => row !== null,
      );
    }

    const own = yes.flatMap(expand);
    const hoisted = no.flatMap(expand);
    // A question that has handed its NON branches to its siblings no longer
    // stands for its own subtree: the row is its remaining branches, and so are
    // the names it holds and the ids it puts in the scope.
    const whole = no.length === 0;
    if (!whole && yes.length === 0) return hoisted;

    const self: OutlineSection = {
      key: section.nodeId,
      label: section.label,
      nodeIds: whole ? [section.nodeId] : yes.map((branch) => branch.nodeId),
      characters: whole ? section.characters : sum(yes),
      // Rule 3: a question with one branch left is that branch.
      children: section.nodeType === 'QUESTION' && own.length === 1 ? (own[0] as OutlineSection).children : own,
    };
    return [self, ...hoisted];
  };

  /** One side of a split question: a row the graph has no single node for. */
  const side = (key: string, label: string, branches: Section[]): OutlineSection | null => {
    if (branches.length === 0) return null;
    const rows = branches.flatMap(expand);
    return {
      key,
      label,
      nodeIds: branches.map((branch) => branch.nodeId),
      characters: sum(branches),
      // One branch only (the women of the Nouveau Testament are a single list):
      // the side and the branch are the same part of the book, shown once.
      children: rows.length === 1 ? (rows[0] as OutlineSection).children : rows,
    };
  };

  return roots.flatMap((root) =>
    root.nodeType === 'START' ? (childrenOf.get(root.nodeId) ?? []).flatMap(expand) : expand(root),
  );
}

/** Every section id a row puts in the scope, itself and its children. */
export function outlineIds(row: OutlineSection): string[] {
  return [...row.nodeIds, ...row.children.flatMap(outlineIds)];
}

/** Finds a row by key, anywhere in the outline. */
export function findOutline(rows: readonly OutlineSection[], key: string): OutlineSection | null {
  for (const row of rows) {
    if (row.key === key) return row;
    const found = findOutline(row.children, key);
    if (found) return found;
  }
  return null;
}
