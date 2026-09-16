// The import plan: what the book says, what the database holds, and the merge between them.
//
// Rule of the house: the book owns the structure, the admin owns the review and the layout.
// An existing row keeps its review status, its review note, its editor position, a description the
// admin edited and every metadata key the book does not write. Rows an admin created are untouched.

import type { ReviewStatus } from '@dsa/core';
import type { CharacterRow, DbSnapshot, EdgeRow, GraphRow, Json, NodeRow } from './rows';
import { BOOK_CHARACTER_METADATA_KEYS, BOOK_EDGE_METADATA_KEYS, BOOK_NODE_METADATA_KEYS, isAdminEdgeRow, isAdminRow } from './rows';

export type RowAction = 'INSERT' | 'UPDATE' | 'UNCHANGED';

export interface RowChange<T> {
  /** Human-readable identity: the node key, the character's node key, or `fromKey -> toKey`. */
  key: string;
  id: string;
  action: RowAction;
  /** The row to write (already merged with what the database holds). */
  row: T;
  /** Book-owned columns that differ from the database. */
  changed: string[];
  /** Admin-owned columns kept from the database instead of the book's value. */
  preserved: string[];
}

export interface PlanOptions {
  /** `--approve`: mark every row of the selected pages APPROVED. */
  approve?: boolean;
  /** `--publish`: the graph becomes PUBLISHED. */
  publish?: boolean;
  /** Pages the run is limited to (`null` = the whole book). Pruning is limited to them too. */
  pages?: number[] | null;
  graphName?: string;
  sourceDocument?: string;
}

export interface ImportPlan {
  graph: RowChange<GraphRow>;
  characters: RowChange<CharacterRow>[];
  nodes: RowChange<NodeRow>[];
  edges: RowChange<EdgeRow>[];
  /** Book rows that vanished from the transcription. Deleted only with `--prune`. */
  prune: { nodes: NodeRow[]; edges: EdgeRow[] };
  /** Admin-created rows found in the database. Never written, never pruned. */
  admin: { nodes: NodeRow[]; edges: EdgeRow[] };
  /** Rows carrying a book `{review}` note that `--approve` approved anyway. */
  approvedWithReviewNote: string[];
}

export interface PlanInput {
  /** The rows the selected pages (plus the spine) should produce. */
  desired: { graph: GraphRow; nodes: NodeRow[]; edges: EdgeRow[]; characters: CharacterRow[] };
  /** Every node key and edge id of the *whole* book, used to find rows that no longer exist. */
  book: { nodeKeys: Set<string>; edgeIds: Set<string> };
  existing: DbSnapshot;
  options?: PlanOptions;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a as Json).filter((k) => (a as Json)[k] !== undefined);
  const kb = Object.keys(b as Json).filter((k) => (b as Json)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Json)[k], (b as Json)[k]));
}

/** Book keys are replaced, admin keys are kept. */
export function mergeMetadata(existing: Json | null | undefined, book: Json, bookKeys: readonly string[]): Json {
  const merged: Json = { ...(existing ?? {}) };
  for (const key of bookKeys) delete merged[key];
  for (const [key, value] of Object.entries(book)) merged[key] = value;
  return merged;
}

/** Metadata keys an admin added, for the "preserved" report. */
function extraMetadataKeys(existing: Json | null | undefined, bookKeys: readonly string[]): string[] {
  return Object.keys(existing ?? {}).filter((k) => !bookKeys.includes(k));
}

function classify<T extends object>(existing: T | undefined, merged: T, columns: (keyof T)[]): { action: RowAction; changed: string[] } {
  if (!existing) return { action: 'INSERT', changed: [] };
  const changed = columns.filter((c) => !deepEqual(existing[c], merged[c])).map(String);
  return { action: changed.length > 0 ? 'UPDATE' : 'UNCHANGED', changed };
}

const NODE_COLUMNS: (keyof NodeRow)[] = [
  'graph_id',
  'node_key',
  'node_type',
  'label',
  'question',
  'description',
  'character_id',
  'source_page',
  'review_status',
  'review_note',
  'position_x',
  'position_y',
  'metadata',
];
const EDGE_COLUMNS: (keyof EdgeRow)[] = [
  'graph_id',
  'from_node_id',
  'to_node_id',
  'answer_label',
  'edge_kind',
  'order_index',
  'source_page',
  'review_status',
  'review_note',
  'metadata',
];
const CHARACTER_COLUMNS: (keyof CharacterRow)[] = [
  'name',
  'name_fr',
  'name_en',
  'gender',
  'testament',
  'description',
  'aliases',
  'is_active',
  'metadata',
];

const reviewStatusFor = (existing: ReviewStatus | undefined, book: ReviewStatus, approve: boolean): ReviewStatus =>
  approve ? 'APPROVED' : (existing ?? book);

export function mergeNode(existing: NodeRow | undefined, book: NodeRow, approve: boolean): RowChange<NodeRow> {
  const preserved: string[] = [];
  const descriptionEdited = existing?.metadata?.description_edited === true;
  const merged: NodeRow = {
    ...(existing ?? {}),
    id: book.id,
    graph_id: book.graph_id,
    node_key: book.node_key,
    node_type: book.node_type,
    label: book.label,
    question: book.question,
    character_id: book.character_id,
    source_page: book.source_page,
    description: descriptionEdited ? (existing?.description ?? null) : book.description,
    position_x: existing?.position_x ?? book.position_x,
    position_y: existing?.position_y ?? book.position_y,
    review_status: reviewStatusFor(existing?.review_status, book.review_status, approve),
    review_note: existing ? existing.review_note : book.review_note,
    metadata: mergeMetadata(existing?.metadata, book.metadata, BOOK_NODE_METADATA_KEYS),
  };
  if (existing) {
    if (descriptionEdited) preserved.push('description');
    if (existing.position_x !== null || existing.position_y !== null) preserved.push('position_x/position_y');
    if (!approve && existing.review_status !== book.review_status) preserved.push('review_status');
    if (existing.review_note !== null && existing.review_note !== book.review_note) preserved.push('review_note');
    const extra = extraMetadataKeys(existing.metadata, BOOK_NODE_METADATA_KEYS);
    if (extra.length > 0) preserved.push(...extra.map((k) => `metadata.${k}`));
  }
  const { action, changed } = classify(existing, merged, NODE_COLUMNS);
  return { key: book.node_key ?? book.id, id: book.id, action, row: merged, changed, preserved };
}

export function mergeEdge(existing: EdgeRow | undefined, book: EdgeRow, approve: boolean, key: string): RowChange<EdgeRow> {
  const preserved: string[] = [];
  const merged: EdgeRow = {
    ...(existing ?? {}),
    id: book.id,
    graph_id: book.graph_id,
    from_node_id: book.from_node_id,
    to_node_id: book.to_node_id,
    answer_label: book.answer_label,
    edge_kind: book.edge_kind,
    order_index: book.order_index,
    source_page: book.source_page,
    review_status: reviewStatusFor(existing?.review_status, book.review_status, approve),
    review_note: existing ? existing.review_note : book.review_note,
    metadata: mergeMetadata(existing?.metadata, book.metadata, BOOK_EDGE_METADATA_KEYS),
  };
  if (existing) {
    if (!approve && existing.review_status !== book.review_status) preserved.push('review_status');
    if (existing.review_note !== null && existing.review_note !== book.review_note) preserved.push('review_note');
    const extra = extraMetadataKeys(existing.metadata, BOOK_EDGE_METADATA_KEYS);
    if (extra.length > 0) preserved.push(...extra.map((k) => `metadata.${k}`));
  }
  const { action, changed } = classify(existing, merged, EDGE_COLUMNS);
  return { key, id: book.id, action, row: merged, changed, preserved };
}

export function mergeCharacter(existing: CharacterRow | undefined, book: CharacterRow): RowChange<CharacterRow> {
  const preserved: string[] = [];
  const descriptionEdited = existing?.metadata?.description_edited === true;
  const aliasesEdited = existing?.metadata?.aliases_edited === true;
  const merged: CharacterRow = {
    ...(existing ?? {}),
    id: book.id,
    name: book.name,
    name_fr: book.name_fr,
    // name_en, gender, testament and is_active are never written by the book.
    name_en: existing ? existing.name_en : book.name_en,
    gender: existing ? existing.gender : book.gender,
    testament: existing ? existing.testament : book.testament,
    is_active: existing ? existing.is_active : book.is_active,
    description: descriptionEdited ? (existing?.description ?? null) : book.description,
    aliases: aliasesEdited ? (existing?.aliases ?? []) : book.aliases,
    metadata: mergeMetadata(existing?.metadata, book.metadata, BOOK_CHARACTER_METADATA_KEYS),
  };
  if (existing) {
    if (descriptionEdited) preserved.push('description');
    if (aliasesEdited) preserved.push('aliases');
    if (existing.name_en !== null || existing.gender !== null || existing.testament !== null) preserved.push('name_en/gender/testament');
    const extra = extraMetadataKeys(existing.metadata, BOOK_CHARACTER_METADATA_KEYS);
    if (extra.length > 0) preserved.push(...extra.map((k) => `metadata.${k}`));
  }
  const { action, changed } = classify(existing, merged, CHARACTER_COLUMNS);
  return { key: String(book.metadata?.node_key ?? book.name), id: book.id, action, row: merged, changed, preserved };
}

export function mergeGraph(existing: GraphRow | null, book: GraphRow, opts: PlanOptions): RowChange<GraphRow> {
  const preserved: string[] = [];
  const merged: GraphRow = {
    ...(existing ?? {}),
    id: book.id,
    slug: book.slug,
    name: opts.graphName ?? book.name,
    description: existing ? existing.description : book.description,
    version: existing ? existing.version : book.version,
    is_active: existing ? existing.is_active : book.is_active,
    // The importer only ever publishes on demand; it never un-publishes.
    status: opts.publish === true ? 'PUBLISHED' : (existing?.status ?? book.status),
    source_document: opts.sourceDocument ?? book.source_document,
    metadata: { ...(existing?.metadata ?? {}) },
  };
  if (existing) {
    if (existing.description !== null) preserved.push('description');
    if (opts.publish !== true && existing.status !== book.status) preserved.push('status');
  }
  const { action, changed } = classify(existing ?? undefined, merged, ['slug', 'name', 'description', 'is_active', 'status', 'source_document', 'metadata']);
  return { key: book.slug, id: book.id, action, row: merged, changed, preserved };
}

const inPruneScope = (page: number | null, pages: number[] | null): boolean =>
  pages === null || (page !== null && pages.includes(page));

export function planImport(input: PlanInput): ImportPlan {
  const opts = input.options ?? {};
  const approve = opts.approve === true;
  const pages = opts.pages ?? null;

  const existingNodes = new Map(input.existing.nodes.map((r) => [r.id, r]));
  const existingEdges = new Map(input.existing.edges.map((r) => [r.id, r]));
  const existingCharacters = new Map(input.existing.characters.map((r) => [r.id, r]));
  const nodeKeyOf = new Map<string, string>();
  for (const r of [...input.existing.nodes, ...input.desired.nodes]) nodeKeyOf.set(r.id, r.node_key ?? r.id);

  const adminNodes = input.existing.nodes.filter(isAdminRow);
  const adminNodeIds = new Set(adminNodes.map((r) => r.id));
  const adminEdges = input.existing.edges.filter((e) => isAdminEdgeRow(e) || adminNodeIds.has(e.from_node_id) || adminNodeIds.has(e.to_node_id));
  const adminEdgeIds = new Set(adminEdges.map((r) => r.id));

  const characters = input.desired.characters.map((c) => mergeCharacter(existingCharacters.get(c.id), c));
  const nodes = input.desired.nodes.map((n) => mergeNode(existingNodes.get(n.id), n, approve));
  const edges = input.desired.edges.map((e) =>
    mergeEdge(existingEdges.get(e.id), e, approve, `${nodeKeyOf.get(e.from_node_id) ?? e.from_node_id} -> ${nodeKeyOf.get(e.to_node_id) ?? e.to_node_id}`),
  );

  const pruneNodes = input.existing.nodes.filter(
    (r) => !adminNodeIds.has(r.id) && !input.book.nodeKeys.has(r.node_key ?? '') && inPruneScope(r.source_page, pages),
  );
  const pruneEdges = input.existing.edges.filter(
    (r) => !adminEdgeIds.has(r.id) && !input.book.edgeIds.has(r.id) && inPruneScope(r.source_page, pages),
  );

  const approvedWithReviewNote = approve
    ? [
        ...nodes.filter((c) => c.row.review_note !== null && c.row.review_note !== '').map((c) => c.key),
        ...edges.filter((c) => c.row.review_note !== null && c.row.review_note !== '').map((c) => c.key),
      ]
    : [];

  return {
    graph: mergeGraph(input.existing.graph, input.desired.graph, opts),
    characters,
    nodes,
    edges,
    prune: { nodes: pruneNodes, edges: pruneEdges },
    admin: { nodes: adminNodes, edges: adminEdges },
    approvedWithReviewNote,
  };
}

export interface Counts {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

export const countChanges = (changes: RowChange<unknown>[]): Counts => ({
  total: changes.length,
  inserted: changes.filter((c) => c.action === 'INSERT').length,
  updated: changes.filter((c) => c.action === 'UPDATE').length,
  unchanged: changes.filter((c) => c.action === 'UNCHANGED').length,
});

export interface PlanSummary {
  graph: RowAction;
  characters: Counts;
  nodes: Counts;
  edges: Counts;
  pruneNodes: number;
  pruneEdges: number;
  adminNodes: number;
  adminEdges: number;
  /** True when applying the plan would write or delete anything. */
  hasChanges: boolean;
}

export function summarize(plan: ImportPlan, prune = false): PlanSummary {
  const nodes = countChanges(plan.nodes);
  const edges = countChanges(plan.edges);
  const characters = countChanges(plan.characters);
  const pruneNodes = plan.prune.nodes.length;
  const pruneEdges = plan.prune.edges.length;
  return {
    graph: plan.graph.action,
    characters,
    nodes,
    edges,
    pruneNodes,
    pruneEdges,
    adminNodes: plan.admin.nodes.length,
    adminEdges: plan.admin.edges.length,
    hasChanges:
      plan.graph.action !== 'UNCHANGED' ||
      nodes.inserted + nodes.updated + edges.inserted + edges.updated + characters.inserted + characters.updated > 0 ||
      (prune && pruneNodes + pruneEdges > 0),
  };
}

export interface PagePlan {
  label: string;
  page: number | null;
  isSpine: boolean;
  nodes: Counts;
  edges: Counts;
  characters: number;
}

/** Splits the plan per source page, for the console table. `spine` holds the ids of the spine nodes. */
export function planByPage(plan: ImportPlan, spine: Set<string>): PagePlan[] {
  const rows = new Map<string, PagePlan & { characterIds: Set<string> }>();
  const row = (isSpine: boolean, page: number | null) => {
    const label = isSpine ? 'spine' : page === null ? '—' : String(page);
    let r = rows.get(label);
    if (!r) {
      r = {
        label,
        page,
        isSpine,
        nodes: { total: 0, inserted: 0, updated: 0, unchanged: 0 },
        edges: { total: 0, inserted: 0, updated: 0, unchanged: 0 },
        characters: 0,
        characterIds: new Set<string>(),
      };
      rows.set(label, r);
    }
    return r;
  };
  const bump = (counts: Counts, action: RowAction) => {
    counts.total++;
    if (action === 'INSERT') counts.inserted++;
    else if (action === 'UPDATE') counts.updated++;
    else counts.unchanged++;
  };
  for (const change of plan.nodes) {
    const isSpine = spine.has(change.id);
    const r = row(isSpine, isSpine ? null : change.row.source_page);
    bump(r.nodes, change.action);
    if (change.row.character_id !== null) r.characterIds.add(change.row.character_id);
  }
  for (const change of plan.edges) {
    const isSpine = spine.has(change.row.from_node_id) && spine.has(change.row.to_node_id);
    const r = row(isSpine, isSpine ? null : change.row.source_page);
    bump(r.edges, change.action);
  }
  return [...rows.values()]
    .map((r) => ({ label: r.label, page: r.page, isSpine: r.isSpine, nodes: r.nodes, edges: r.edges, characters: r.characterIds.size }))
    .sort((a, b) => (a.isSpine !== b.isSpine ? (a.isSpine ? -1 : 1) : (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER)));
}

/** The rows the database would hold once the plan is applied. Used to check playability before publishing. */
export function projectSnapshot(existing: DbSnapshot, plan: ImportPlan, prune = false): DbSnapshot {
  const nodes = new Map(existing.nodes.map((r) => [r.id, r]));
  const edges = new Map(existing.edges.map((r) => [r.id, r]));
  const characters = new Map(existing.characters.map((r) => [r.id, r]));
  for (const c of plan.nodes) nodes.set(c.id, c.row);
  for (const c of plan.edges) edges.set(c.id, c.row);
  for (const c of plan.characters) characters.set(c.id, c.row);
  if (prune) {
    for (const r of plan.prune.nodes) nodes.delete(r.id);
    for (const r of plan.prune.edges) edges.delete(r.id);
  }
  // A deleted node takes its edges with it (ON DELETE CASCADE).
  const nodeIds = new Set(nodes.keys());
  for (const [id, e] of edges) if (!nodeIds.has(e.from_node_id) || !nodeIds.has(e.to_node_id)) edges.delete(id);
  return { graph: plan.graph.row, nodes: [...nodes.values()], edges: [...edges.values()], characters: [...characters.values()] };
}
