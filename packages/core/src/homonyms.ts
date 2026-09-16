import type { GraphIndex } from './graph-index';
import { normalizeName } from './normalize';

/**
 * True when another playable CHARACTER of the graph (reachable from START through
 * approved edges) has the same normalized name and is a different person
 * (GRAPH_SPECIFICATION.md §8). Two JACQUES are homonyms; ABRAHAM and ABRAM, one
 * person with one character row, are not. SQL mirror: `dsa_has_homonyms`.
 *
 * The card shows its description only when this is true.
 */
export function hasHomonyms(ix: GraphIndex, nodeId: string): boolean {
  const node = ix.node(nodeId);
  if (!node) return false;
  const name = normalizeName(node.label);
  return ix
    .playableCharacters()
    .some(
      (other) =>
        other.id !== node.id &&
        normalizeName(other.label) === name &&
        (node.characterId === null || other.characterId === null || other.characterId !== node.characterId),
    );
}
