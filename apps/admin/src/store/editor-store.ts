/**
 * Editor state: the working copy of the graph, the undo/redo history and the
 * current selection. Nothing here talks to Supabase — `Enregistrer` diffs the
 * working copy against `baseline` and hands that to the repository.
 *
 * History holds whole snapshots. A snapshot is three arrays of references, so a
 * 1,650-node graph costs a few thousand pointer copies per edit, which is far
 * cheaper than tracking inverse operations for every command.
 */
import {
  characterKey as buildCharacterKey,
  collisionKey,
  slugify,
  spineChildKey,
  treeChildKey,
  type BibleCharacter,
  type Graph,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from '@dsa/core';
import { create } from 'zustand';
import { computeDiff, summarize, type DiffSummary, type GraphDiff } from '../lib/diff';
import type { XY } from '../lib/layout';
import { buildTree, defaultAnswerLabel, edgeKindFor, subtreeIds } from '../lib/tree';

export const HISTORY_LIMIT = 120;

export interface Draft {
  graph: Graph;
  nodes: GraphNode[];
  edges: GraphEdge[];
  characters: BibleCharacter[];
}

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export interface NewChildInit {
  nodeType: NodeType;
  label: string;
  /** The clue, for a CHARACTER child. */
  question?: string | null;
  answerLabel?: string;
  /** Where the canvas wants the card, so a new child is never stacked at the origin. */
  position?: XY;
}

interface EditorState {
  baseline: GraphData | null;
  present: Draft | null;
  past: Draft[];
  future: Draft[];
  /** Consecutive edits sharing a merge key collapse into one history entry. */
  mergeKey: string | null;
  selection: Selection;

  load(data: GraphData): void;
  markSaved(): void;

  undo(): void;
  redo(): void;

  select(selection: Selection): void;

  updateGraph(patch: Partial<Graph>, mergeKey?: string): void;
  updateNode(id: string, patch: Partial<GraphNode>, mergeKey?: string): void;
  updateEdge(id: string, patch: Partial<GraphEdge>, mergeKey?: string): void;
  updateCharacter(id: string, patch: Partial<BibleCharacter>, mergeKey?: string): void;
  addCharacter(character: BibleCharacter): void;
  /**
   * Edits what the Tireur's card shows for this leaf: the character's
   * description, mirrored on every CHARACTER node of that character, with
   * `metadata.description_edited = true` on all of them so the importer keeps
   * the text (IMPORT_GUIDE §8). A leaf with no character only changes itself.
   */
  setCardDescription(nodeId: string, description: string | null, mergeKey?: string): void;

  addChild(parentId: string, init: NewChildInit): string | null;
  deleteNode(id: string): void;
  moveNode(id: string, position: XY): void;
  /** Forgets hand-placed positions, so those cards fall back to the automatic layout. */
  clearPositions(ids: Iterable<string>): void;
  connect(fromId: string, toId: string): string | null;
  deleteEdge(id: string): void;
  /** Moves an edge one step earlier or later among its siblings, renumbering them 0..n-1. */
  reorderEdge(id: string, direction: -1 | 1): void;
}

export const useEditorStore = create<EditorState>()((set, get) => {
  /**
   * Runs `mutate` on a copy of the present draft and pushes the previous one
   * onto the history, unless it can merge with the entry already on top.
   */
  function commit(mutate: (draft: Draft) => void, mergeKey?: string): void {
    const state = get();
    const present = state.present;
    if (!present) return;
    const next: Draft = { graph: present.graph, nodes: [...present.nodes], edges: [...present.edges], characters: [...present.characters] };
    mutate(next);
    const merging = mergeKey !== undefined && mergeKey === state.mergeKey && state.past.length > 0;
    const past = merging ? state.past : [...state.past, present].slice(-HISTORY_LIMIT);
    set({ present: next, past, future: [], mergeKey: mergeKey ?? null });
  }

  return {
    baseline: null,
    present: null,
    past: [],
    future: [],
    mergeKey: null,
    selection: null,

    load(data) {
      set({
        baseline: data,
        present: { graph: data.graph, nodes: [...data.nodes], edges: [...data.edges], characters: [...data.characters] },
        past: [],
        future: [],
        mergeKey: null,
        selection: null,
      });
    },

    markSaved() {
      const present = get().present;
      if (!present) return;
      set({ baseline: toGraphData(present) });
    },

    undo() {
      const { past, present, future } = get();
      const previous = past[past.length - 1];
      if (!previous || !present) return;
      set({ present: previous, past: past.slice(0, -1), future: [present, ...future], mergeKey: null });
    },

    redo() {
      const { past, present, future } = get();
      const next = future[0];
      if (!next || !present) return;
      set({ present: next, past: [...past, present], future: future.slice(1), mergeKey: null });
    },

    select(selection) {
      set({ selection });
    },

    updateGraph(patch, mergeKey) {
      commit((draft) => {
        draft.graph = { ...draft.graph, ...patch };
      }, mergeKey);
    },

    updateNode(id, patch, mergeKey) {
      commit((draft) => {
        draft.nodes = draft.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
      }, mergeKey);
    },

    updateEdge(id, patch, mergeKey) {
      commit((draft) => {
        draft.edges = draft.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge));
      }, mergeKey);
    },

    updateCharacter(id, patch, mergeKey) {
      commit((draft) => {
        draft.characters = draft.characters.map((character) => (character.id === id ? { ...character, ...patch } : character));
      }, mergeKey);
    },

    addCharacter(character) {
      commit((draft) => {
        draft.characters = [...draft.characters, character];
      });
    },

    setCardDescription(nodeId, description, mergeKey) {
      const present = get().present;
      const leaf = present?.nodes.find((node) => node.id === nodeId);
      if (!present || !leaf) return;
      const text = description !== null && description.trim() === '' ? null : description;
      const characterId = leaf.characterId;
      const character = characterId ? present.characters.find((candidate) => candidate.id === characterId) : undefined;
      commit((draft) => {
        if (character) {
          draft.characters = draft.characters.map((candidate) =>
            candidate.id === character.id
              ? { ...candidate, description: text, metadata: { ...candidate.metadata, description_edited: true } }
              : candidate,
          );
        }
        draft.nodes = draft.nodes.map((node) =>
          node.id === nodeId || (character && node.characterId === character.id && node.nodeType === 'CHARACTER')
            ? { ...node, description: text, metadata: { ...node.metadata, description_edited: true } }
            : node,
        );
      }, mergeKey);
    },

    addChild(parentId, init) {
      const present = get().present;
      if (!present) return null;
      const parent = present.nodes.find((node) => node.id === parentId);
      if (!parent) return null;

      const tree = buildTree(present.nodes, present.edges);
      const siblings = tree.childEdges.get(parentId) ?? [];
      const kind = edgeKindFor(parent);
      const answerLabel = init.answerLabel ?? defaultAnswerLabel(kind);
      const question = init.question ?? null;
      const key = uniqueKey(present.nodes, parent, init.nodeType, init.label, question, answerLabel);

      const node: GraphNode = {
        id: newId(),
        graphId: present.graph.id,
        nodeKey: key,
        nodeType: init.nodeType,
        label: init.label,
        question,
        description: null,
        characterId: null,
        sourcePage: parent.sourcePage,
        positionX: init.position ? round(init.position.x) : null,
        positionY: init.position ? round(init.position.y) : null,
        reviewStatus: 'DRAFT',
        reviewNote: null,
        metadata: { origin: 'admin' },
      };
      const edge: GraphEdge = {
        id: newId(),
        graphId: present.graph.id,
        fromNodeId: parentId,
        toNodeId: node.id,
        answerLabel,
        edgeKind: kind,
        // Appended at the end of the parent's children (brief: "appended at the
        // end"), which for 0-based book order is the current child count.
        orderIndex: siblings.length,
        sourcePage: parent.sourcePage,
        reviewStatus: 'DRAFT',
        reviewNote: null,
        metadata: { origin: 'admin' },
      };
      commit((draft) => {
        draft.nodes = [...draft.nodes, node];
        draft.edges = [...draft.edges, edge];
      });
      set({ selection: { kind: 'node', id: node.id } });
      return node.id;
    },

    deleteNode(id) {
      const present = get().present;
      if (!present) return;
      const tree = buildTree(present.nodes, present.edges);
      const doomed = subtreeIds(tree, id, Number.POSITIVE_INFINITY);
      commit((draft) => {
        draft.nodes = draft.nodes.filter((node) => !doomed.has(node.id));
        draft.edges = draft.edges.filter((edge) => !doomed.has(edge.fromNodeId) && !doomed.has(edge.toNodeId));
      });
      const selection = get().selection;
      if (selection && selection.kind === 'node' && doomed.has(selection.id)) set({ selection: null });
    },

    moveNode(id, position) {
      get().updateNode(id, { positionX: round(position.x), positionY: round(position.y) }, `move:${id}`);
    },

    clearPositions(ids) {
      const wanted = new Set(ids);
      const present = get().present;
      if (!present || !present.nodes.some((node) => wanted.has(node.id) && (node.positionX !== null || node.positionY !== null))) return;
      commit((draft) => {
        draft.nodes = draft.nodes.map((node) =>
          wanted.has(node.id) && (node.positionX !== null || node.positionY !== null) ? { ...node, positionX: null, positionY: null } : node,
        );
      });
    },

    connect(fromId, toId) {
      const present = get().present;
      if (!present || fromId === toId) return null;
      const from = present.nodes.find((node) => node.id === fromId);
      if (!from || !present.nodes.some((node) => node.id === toId)) return null;
      if (present.edges.some((edge) => edge.fromNodeId === fromId && edge.toNodeId === toId)) return null;
      const kind = edgeKindFor(from);
      const edge: GraphEdge = {
        id: newId(),
        graphId: present.graph.id,
        fromNodeId: fromId,
        toNodeId: toId,
        answerLabel: defaultAnswerLabel(kind),
        edgeKind: kind,
        orderIndex: present.edges.filter((e) => e.fromNodeId === fromId).length,
        sourcePage: from.sourcePage,
        reviewStatus: 'DRAFT',
        reviewNote: null,
        metadata: { origin: 'admin' },
      };
      commit((draft) => {
        draft.edges = [...draft.edges, edge];
      });
      set({ selection: { kind: 'edge', id: edge.id } });
      return edge.id;
    },

    deleteEdge(id) {
      commit((draft) => {
        const removed = draft.edges.find((edge) => edge.id === id);
        draft.edges = draft.edges.filter((edge) => edge.id !== id);
        if (removed) draft.edges = renumber(draft.edges, removed.fromNodeId);
      });
      const selection = get().selection;
      if (selection && selection.kind === 'edge' && selection.id === id) set({ selection: null });
    },

    reorderEdge(id, direction) {
      commit((draft) => {
        const edge = draft.edges.find((candidate) => candidate.id === id);
        if (!edge) return;
        const siblings = draft.edges.filter((candidate) => candidate.fromNodeId === edge.fromNodeId).sort(byOrder);
        const at = siblings.findIndex((candidate) => candidate.id === id);
        const target = at + direction;
        if (at < 0 || target < 0 || target >= siblings.length) return;
        const reordered = [...siblings];
        const [moved] = reordered.splice(at, 1);
        if (moved) reordered.splice(target, 0, moved);
        const orderById = new Map(reordered.map((candidate, index) => [candidate.id, index]));
        draft.edges = draft.edges.map((candidate) => {
          const order = orderById.get(candidate.id);
          return order === undefined || order === candidate.orderIndex ? candidate : { ...candidate, orderIndex: order };
        });
      });
    },
  };
});

function byOrder(a: GraphEdge, b: GraphEdge): number {
  return a.orderIndex - b.orderIndex || (a.id < b.id ? -1 : 1);
}

/** Closes the gap left by a removed child so siblings stay numbered 0..n-1. */
function renumber(edges: GraphEdge[], fromNodeId: string): GraphEdge[] {
  const siblings = edges.filter((edge) => edge.fromNodeId === fromNodeId).sort(byOrder);
  const orderById = new Map(siblings.map((edge, index) => [edge.id, index]));
  return edges.map((edge) => {
    const order = orderById.get(edge.id);
    return order === undefined || order === edge.orderIndex ? edge : { ...edge, orderIndex: order };
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Admin-created rows get random v4 ids (GRAPH_SPECIFICATION §7), never the salted v5 ids of the book. */
function newId(): string {
  return crypto.randomUUID();
}

/**
 * Builds the `node_key` of a new child with the book's own rules, then adds the
 * `~2`, `~3` collision suffix until it is free (`node_key` is NOT NULL and
 * unique per graph).
 */
export function uniqueKey(
  nodes: readonly GraphNode[],
  parent: GraphNode,
  nodeType: NodeType,
  label: string,
  question: string | null,
  answerLabel: string,
): string {
  const taken = new Set(nodes.map((node) => node.nodeKey));
  let base: string;
  if (parent.nodeType === 'START') base = slugify(label);
  else if (parent.nodeType === 'QUESTION') base = spineChildKey(parent.nodeKey, answerLabel, label);
  else if (nodeType === 'CHARACTER') base = buildCharacterKey(parent.nodeKey, question, label);
  else base = treeChildKey(parent.nodeKey, label);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = collisionKey(base, n);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}~${newId()}`;
}

export function toGraphData(draft: Draft): GraphData {
  return { graph: draft.graph, nodes: draft.nodes, edges: draft.edges, characters: draft.characters };
}

export function draftDiff(baseline: GraphData | null, present: Draft | null): GraphDiff | null {
  if (!baseline || !present) return null;
  return computeDiff(baseline, toGraphData(present));
}

export function draftSummary(baseline: GraphData | null, present: Draft | null): DiffSummary | null {
  const diff = draftDiff(baseline, present);
  return diff ? summarize(diff) : null;
}
