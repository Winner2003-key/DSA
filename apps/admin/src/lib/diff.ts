/**
 * The batch diff between the graph as it was loaded and the graph as it is in
 * the editor. `Enregistrer` sends exactly this, and the summary it produces is
 * what the admin reads before confirming.
 */
import type { BibleCharacter, Graph, GraphData, GraphEdge, GraphNode } from '@dsa/core';

export interface RowChange<T> {
  before: T;
  after: T;
  /** Field names of `T` whose value differs, sorted. */
  changed: string[];
}

export interface RowDiff<T> {
  created: T[];
  updated: RowChange<T>[];
  deleted: T[];
}

export interface GraphDiff {
  graphId: string;
  graph: RowChange<Graph> | null;
  nodes: RowDiff<GraphNode>;
  edges: RowDiff<GraphEdge>;
  characters: RowDiff<BibleCharacter>;
}

export interface DiffSummary {
  total: number;
  nodesCreated: number;
  nodesUpdated: number;
  nodesDeleted: number;
  /** Node updates whose only changed fields are positionX / positionY. */
  nodesMoved: number;
  edgesCreated: number;
  edgesUpdated: number;
  edgesDeleted: number;
  /** Edge updates that changed `orderIndex`. */
  edgesReordered: number;
  charactersCreated: number;
  charactersUpdated: number;
  charactersDeleted: number;
  graphChanged: boolean;
}

const POSITION_FIELDS = new Set(['positionX', 'positionY']);

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Deep value equality, good enough for the JSON-shaped values that graph rows
 * hold (scalars, string arrays and metadata objects). Object key order is not
 * significant, so `{a:1,b:2}` equals `{b:2,a:1}` and an untouched metadata blob
 * never shows up as an edit.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) return false;
  return aKeys.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

export function changedFields<T extends object>(before: T, after: T): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!sameValue((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key])) changed.push(key);
  }
  return changed.sort();
}

function diffRows<T extends { id: string }>(before: readonly T[], after: readonly T[]): RowDiff<T> {
  const beforeById = byId(before);
  const afterById = byId(after);
  const diff: RowDiff<T> = { created: [], updated: [], deleted: [] };
  for (const row of after) {
    const previous = beforeById.get(row.id);
    if (!previous) {
      diff.created.push(row);
      continue;
    }
    const changed = changedFields(previous, row);
    if (changed.length > 0) diff.updated.push({ before: previous, after: row, changed });
  }
  for (const row of before) {
    if (!afterById.has(row.id)) diff.deleted.push(row);
  }
  return diff;
}

export function computeDiff(before: GraphData, after: GraphData): GraphDiff {
  const graphChanged = changedFields(before.graph, after.graph);
  return {
    graphId: after.graph.id,
    graph: graphChanged.length > 0 ? { before: before.graph, after: after.graph, changed: graphChanged } : null,
    nodes: diffRows(before.nodes, after.nodes),
    edges: diffRows(before.edges, after.edges),
    characters: diffRows(before.characters, after.characters),
  };
}

export function isPositionOnly(change: RowChange<GraphNode>): boolean {
  return change.changed.length > 0 && change.changed.every((field) => POSITION_FIELDS.has(field));
}

export function summarize(diff: GraphDiff): DiffSummary {
  const nodesMoved = diff.nodes.updated.filter(isPositionOnly).length;
  const edgesReordered = diff.edges.updated.filter((change) => change.changed.includes('orderIndex')).length;
  const summary: DiffSummary = {
    total:
      diff.nodes.created.length +
      diff.nodes.updated.length +
      diff.nodes.deleted.length +
      diff.edges.created.length +
      diff.edges.updated.length +
      diff.edges.deleted.length +
      diff.characters.created.length +
      diff.characters.updated.length +
      diff.characters.deleted.length +
      (diff.graph ? 1 : 0),
    nodesCreated: diff.nodes.created.length,
    nodesUpdated: diff.nodes.updated.length - nodesMoved,
    nodesDeleted: diff.nodes.deleted.length,
    nodesMoved,
    edgesCreated: diff.edges.created.length,
    edgesUpdated: diff.edges.updated.length,
    edgesDeleted: diff.edges.deleted.length,
    edgesReordered,
    charactersCreated: diff.characters.created.length,
    charactersUpdated: diff.characters.updated.length,
    charactersDeleted: diff.characters.deleted.length,
    graphChanged: diff.graph !== null,
  };
  return summary;
}

const PLURAL = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** The French one-line-per-kind summary shown in the save dialog. */
export function describeDiff(summary: DiffSummary): string[] {
  const lines: string[] = [];
  if (summary.nodesCreated > 0) lines.push(`${PLURAL(summary.nodesCreated, 'nœud ajouté', 'nœuds ajoutés')}`);
  if (summary.nodesUpdated > 0) lines.push(`${PLURAL(summary.nodesUpdated, 'nœud modifié', 'nœuds modifiés')}`);
  if (summary.nodesMoved > 0) lines.push(`${PLURAL(summary.nodesMoved, 'nœud déplacé', 'nœuds déplacés')}`);
  if (summary.nodesDeleted > 0) lines.push(`${PLURAL(summary.nodesDeleted, 'nœud supprimé', 'nœuds supprimés')}`);
  if (summary.edgesCreated > 0) lines.push(`${PLURAL(summary.edgesCreated, 'arête ajoutée', 'arêtes ajoutées')}`);
  if (summary.edgesUpdated > 0) {
    const reordered = summary.edgesReordered > 0 ? ` (dont ${summary.edgesReordered} réordonnée${summary.edgesReordered > 1 ? 's' : ''})` : '';
    lines.push(`${PLURAL(summary.edgesUpdated, 'arête modifiée', 'arêtes modifiées')}${reordered}`);
  }
  if (summary.edgesDeleted > 0) lines.push(`${PLURAL(summary.edgesDeleted, 'arête supprimée', 'arêtes supprimées')}`);
  if (summary.charactersCreated > 0) lines.push(`${PLURAL(summary.charactersCreated, 'personnage ajouté', 'personnages ajoutés')}`);
  if (summary.charactersUpdated > 0) lines.push(`${PLURAL(summary.charactersUpdated, 'personnage modifié', 'personnages modifiés')}`);
  if (summary.charactersDeleted > 0) lines.push(`${PLURAL(summary.charactersDeleted, 'personnage supprimé', 'personnages supprimés')}`);
  if (summary.graphChanged) lines.push('propriétés du graphe modifiées');
  return lines;
}

export function isEmptyDiff(diff: GraphDiff): boolean {
  return summarize(diff).total === 0;
}
