/**
 * Homonyms: people of the book who share a name (GRAPH_SPECIFICATION §8).
 *
 * The Tireur's card shows the description only when the drawn name is shared,
 * and then that description is the only thing telling the Tireur *which* person
 * to have discovered. This module finds those people, judges whether their
 * descriptions actually tell them apart, and proposes a longer one from the
 * book path. It is pure: no React, no Supabase.
 */
import { normalizeName, normalizeText, type BibleCharacter, type GraphData, type GraphNode } from '@dsa/core';
import { bookOrder } from './review';
import { ancestorChain, buildTree, type GraphTree } from './tree';

/** One person (one character) carrying a shared name. */
export interface HomonymPerson {
  /** `characterId`, or the node id for a leaf with no character yet. */
  key: string;
  /** The first CHARACTER node of this person with this name, in book order. */
  node: GraphNode;
  /** Other nodes of the same person with the same name (a `{same-as}` leaf on another page). */
  otherNodes: GraphNode[];
  character: BibleCharacter | null;
  /** What the Tireur's card shows: the character's description, else the node's (as `dsa_get_my_secret`). */
  description: string | null;
  /** Root first, the node last. */
  path: GraphNode[];
  weak: boolean;
  /** Another person of the same name has the same description. */
  identical: boolean;
  edited: boolean;
}

export interface HomonymGroup {
  /** `normalizeName(label)`. */
  key: string;
  /** The label as printed on the first person's leaf. */
  name: string;
  people: HomonymPerson[];
}

export interface HomonymStats {
  names: number;
  people: number;
  weak: number;
  identical: number;
  /** People whose description is weak or identical: the work left. */
  unresolved: number;
  edited: number;
}

// ---------------------------------------------------------------------------
// Weak descriptions

const ORDINAL =
  "(?:\\d+\\s?(?:er|ere|e|eme|em|nd|nde)?|premier|premiere|second|seconde|deuxieme|troisieme|quatrieme|cinquieme|sixieme|septieme|huitieme|neuvieme|dixieme|onzieme|douzieme|dernier|derniere|avant dernier|avant derniere|aine|ainee|cadet|cadette|benjamin|benjamine|puine|puinee)";
const ARTICLE = "(?:(?:le|la|les|l')\\s?)?";
const KIN =
  '(?:pere|mere|fils|fille|filles|enfant|enfants|frere|freres|soeur|soeurs|femme|femmes|epouse|epouses|mari|oncle|tante|neveu|niece|cousin|cousine|grand pere|grand mere|petit fils|petite fille|petits fils|beau pere|belle mere|beau frere|belle soeur|gendre|bru|ancetre|descendant|serviteur|servante)';

/**
 * Clues that name a rank or a relation but not a person: on their own they
 * cannot tell two homonyms apart. Matched against `normalizeText(clue)`, so
 * case, accents and punctuation do not matter. This is the single list the
 * "Descriptions faibles" filter uses; extend it here.
 */
export const GENERIC_CLUE_PATTERNS: readonly RegExp[] = [
  // "1er", "2ème", "Le 1er", "Le dernier", "L'aîné", "2ème fils"
  new RegExp(`^${ARTICLE}${ORDINAL}(?:\\s${KIN})?$`),
  // "Son père", "Sa femme", "Ses fils", "Un frère"
  new RegExp(`^(?:son|sa|ses|leur|leurs|un|une|le|la|les|l')\\s?${KIN}$`),
  // "plus connu", "moins connu" (and the book's "moin connu")
  /^(?:le |la )?(?:plus|moins|moin|tres|peu) (?:connu|connue|celebre)$/,
  // placeholders
  /^(?:autre|un autre|une autre|l'autre|idem|meme nom|homonyme|inconnu|inconnue|anonyme)$/,
];

export function isGenericClue(clue: string | null | undefined): boolean {
  if (!clue) return true;
  const text = normalizeText(clue);
  if (text === '') return true;
  return GENERIC_CLUE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Splits a card description on the separators the importer and the suggestion use. */
export function descriptionSegments(description: string | null | undefined): string[] {
  if (!description) return [];
  return description
    .split(/\s*[·•|]\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * A description is weak when it cannot tell a person apart:
 * - it is empty;
 * - every segment is generic ("plus connu");
 * - or it is the generated shape `<generic clue> · <one section>` ("1er · SES FILS": whose sons?).
 *
 * Adding a second section ("1er · SES FILS · LIE A SEM") makes it strong.
 */
export function isWeakDescription(description: string | null | undefined): boolean {
  const segments = descriptionSegments(description);
  if (segments.length === 0) return true;
  if (segments.every((segment) => isGenericClue(segment))) return true;
  return isGenericClue(segments[0]) && segments.length <= 2;
}

// ---------------------------------------------------------------------------
// Identical descriptions

function descriptionKey(description: string | null): string {
  return normalizeText(description ?? '');
}

/** Keys of the people whose description equals another person's in the same group. */
export function identicalKeys(people: readonly Pick<HomonymPerson, 'key' | 'description'>[]): Set<string> {
  const byDescription = new Map<string, string[]>();
  for (const person of people) {
    const key = descriptionKey(person.description);
    byDescription.set(key, [...(byDescription.get(key) ?? []), person.key]);
  }
  const identical = new Set<string>();
  for (const keys of byDescription.values()) {
    if (keys.length > 1) for (const key of keys) identical.add(key);
  }
  return identical;
}

// ---------------------------------------------------------------------------
// Suggestion

/**
 * `clue · parent · grandparent`, from the book path. GROUP ancestors (CLASSE,
 * TOME, ALIAS) and START are skipped, as in the importer's description rule
 * (GRAPH_SPECIFICATION §7): "CLASSE 1" says nothing about a person. For a leaf
 * under an ALIAS group the group label is the clue. Never saved on its own; the
 * page only puts it in the field.
 */
export function suggestDescription(tree: GraphTree, nodeId: string): string {
  const chain = ancestorChain(tree, nodeId);
  const node = chain[chain.length - 1];
  if (!node) return '';
  const ancestors = chain.slice(0, -1).reverse();
  const aliasGroup = ancestors[0]?.nodeType === 'GROUP' && ancestors[0].metadata.group_kind === 'ALIAS' ? ancestors[0] : null;
  // Under an ALIAS group the leaf's "question" is only the qualifier ("plus connu").
  const clue = aliasGroup?.label ?? (node.question?.trim() || null);
  const sections = ancestors
    .filter((ancestor) => ancestor.nodeType !== 'GROUP' && ancestor.nodeType !== 'START')
    .slice(0, 2)
    .map((ancestor) => ancestor.label.trim());
  const segments: string[] = [];
  for (const segment of [clue, ...sections]) {
    if (!segment) continue;
    if (segments.some((existing) => normalizeText(existing) === normalizeText(segment))) continue;
    segments.push(segment);
  }
  return segments.join(' · ');
}

// ---------------------------------------------------------------------------
// Grouping

/**
 * Every name carried by CHARACTER nodes of two or more **different** people,
 * grouped by `normalizeName(label)`. Aliases of one person (several leaves
 * sharing one `characterId`) count once. A leaf with no character yet counts as
 * its own person, like `hasHomonyms` in core.
 *
 * Unlike the game, which only counts playable (approved, reachable) leaves, the
 * admin sees every leaf, so descriptions can be fixed before approval.
 */
export function findHomonyms(data: GraphData, tree: GraphTree = buildTree(data.nodes, data.edges)): HomonymGroup[] {
  const order = bookOrder(tree);
  const rank = (node: GraphNode) => order.get(node.id) ?? Number.MAX_SAFE_INTEGER;
  const characters = new Map(data.characters.map((character) => [character.id, character]));

  const byName = new Map<string, GraphNode[]>();
  for (const node of data.nodes) {
    if (node.nodeType !== 'CHARACTER') continue;
    const key = normalizeName(node.label);
    if (key === '') continue;
    byName.set(key, [...(byName.get(key) ?? []), node]);
  }

  const groups: HomonymGroup[] = [];
  for (const [key, nodes] of byName) {
    const byPerson = new Map<string, GraphNode[]>();
    for (const node of [...nodes].sort((a, b) => rank(a) - rank(b) || a.nodeKey.localeCompare(b.nodeKey))) {
      const personKey = node.characterId ?? node.id;
      byPerson.set(personKey, [...(byPerson.get(personKey) ?? []), node]);
    }
    if (byPerson.size < 2) continue;

    const people = [...byPerson.entries()].map(([personKey, personNodes]): HomonymPerson => {
      const [first, ...others] = personNodes as [GraphNode, ...GraphNode[]];
      const character = first.characterId ? (characters.get(first.characterId) ?? null) : null;
      const description = character?.description ?? first.description ?? null;
      return {
        key: personKey,
        node: first,
        otherNodes: others,
        character,
        description,
        path: ancestorChain(tree, first.id),
        weak: isWeakDescription(description),
        identical: false,
        edited: character ? character.metadata.description_edited === true : first.metadata.description_edited === true,
      };
    });
    const identical = identicalKeys(people);
    for (const person of people) person.identical = identical.has(person.key);

    groups.push({ key, name: people[0]?.node.label ?? key, people });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function homonymStats(groups: readonly HomonymGroup[]): HomonymStats {
  const people = groups.flatMap((group) => group.people);
  return {
    names: groups.length,
    people: people.length,
    weak: people.filter((person) => person.weak).length,
    identical: people.filter((person) => person.identical).length,
    unresolved: people.filter((person) => person.weak || person.identical).length,
    edited: people.filter((person) => person.edited).length,
  };
}

export type HomonymFilter = 'ALL' | 'WEAK' | 'EDITED' | 'IDENTICAL';

/** Keeps a group when at least one of its people matches, and keeps the whole group for context. */
export function filterHomonyms(groups: readonly HomonymGroup[], filter: HomonymFilter, search = ''): HomonymGroup[] {
  const needle = normalizeName(search);
  return groups.filter((group) => {
    if (needle !== '' && !group.key.includes(needle)) return false;
    if (filter === 'ALL') return true;
    return group.people.some((person) =>
      filter === 'WEAK' ? person.weak : filter === 'EDITED' ? person.edited : person.identical,
    );
  });
}
