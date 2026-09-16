// GraphData ↔ Supabase rows (DATABASE_SCHEMA.md §1). The database is snake_case; @dsa/core is camelCase.

import type { BibleCharacter, EdgeKind, Graph, GraphData, GraphEdge, GraphNode, GraphStatus, NodeType, ReviewStatus } from '@dsa/core';

export type Json = Record<string, unknown>;

export interface GraphRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
  status: GraphStatus;
  source_document: string | null;
  metadata: Json;
}

export interface CharacterRow {
  id: string;
  name: string;
  name_fr: string | null;
  name_en: string | null;
  gender: 'M' | 'F' | null;
  testament: 'ANCIEN' | 'NOUVEAU' | null;
  description: string | null;
  aliases: string[];
  is_active: boolean;
  metadata: Json;
}

export interface NodeRow {
  id: string;
  graph_id: string;
  node_key: string | null;
  node_type: NodeType;
  label: string;
  question: string | null;
  description: string | null;
  character_id: string | null;
  source_page: number | null;
  position_x: number | null;
  position_y: number | null;
  review_status: ReviewStatus;
  review_note: string | null;
  metadata: Json;
}

export interface EdgeRow {
  id: string;
  graph_id: string;
  from_node_id: string;
  to_node_id: string;
  answer_label: string;
  edge_kind: EdgeKind;
  order_index: number;
  source_page: number | null;
  review_status: ReviewStatus;
  review_note: string | null;
  metadata: Json;
}

export interface DbSnapshot {
  graph: GraphRow | null;
  nodes: NodeRow[];
  edges: EdgeRow[];
  characters: CharacterRow[];
}

/** Metadata keys the book owns. Anything else on an existing row was added by an admin and is kept. */
export const BOOK_NODE_METADATA_KEYS = [
  'printed_page',
  'extra_pages',
  'group_kind',
  'qualifier',
  'target_node_key',
  'notes',
  'variants',
  'same_as',
] as const;
export const BOOK_EDGE_METADATA_KEYS = ['source_variants', 'notes'] as const;
export const BOOK_CHARACTER_METADATA_KEYS = ['node_key', 'source_page', 'printed_page', 'extra_pages', 'notes', 'variants'] as const;

export function graphToRow(g: Graph): GraphRow {
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    version: g.version,
    is_active: g.isActive,
    status: g.status,
    source_document: g.sourceDocument,
    metadata: {},
  };
}

export function rowToGraph(r: GraphRow): Graph {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    version: r.version,
    isActive: r.is_active,
    status: r.status,
    sourceDocument: r.source_document,
  };
}

export function characterToRow(c: BibleCharacter): CharacterRow {
  return {
    id: c.id,
    name: c.name,
    name_fr: c.nameFr,
    name_en: c.nameEn,
    gender: c.gender,
    testament: c.testament,
    description: c.description,
    aliases: c.aliases,
    is_active: c.isActive,
    metadata: c.metadata as Json,
  };
}

export function rowToCharacter(r: CharacterRow): BibleCharacter {
  return {
    id: r.id,
    name: r.name,
    nameFr: r.name_fr,
    nameEn: r.name_en,
    gender: r.gender,
    testament: r.testament,
    description: r.description,
    aliases: r.aliases ?? [],
    isActive: r.is_active,
    metadata: r.metadata ?? {},
  };
}

export function nodeToRow(n: GraphNode): NodeRow {
  return {
    id: n.id,
    graph_id: n.graphId,
    node_key: n.nodeKey,
    node_type: n.nodeType,
    label: n.label,
    question: n.question,
    description: n.description,
    character_id: n.characterId,
    source_page: n.sourcePage,
    position_x: n.positionX,
    position_y: n.positionY,
    review_status: n.reviewStatus,
    review_note: n.reviewNote,
    metadata: n.metadata as Json,
  };
}

export function rowToNode(r: NodeRow): GraphNode {
  return {
    id: r.id,
    graphId: r.graph_id,
    nodeKey: r.node_key ?? '',
    nodeType: r.node_type,
    label: r.label,
    question: r.question,
    description: r.description,
    characterId: r.character_id,
    sourcePage: r.source_page,
    positionX: r.position_x,
    positionY: r.position_y,
    reviewStatus: r.review_status,
    reviewNote: r.review_note,
    metadata: r.metadata ?? {},
  };
}

export function edgeToRow(e: GraphEdge): EdgeRow {
  return {
    id: e.id,
    graph_id: e.graphId,
    from_node_id: e.fromNodeId,
    to_node_id: e.toNodeId,
    answer_label: e.answerLabel,
    edge_kind: e.edgeKind,
    order_index: e.orderIndex,
    source_page: e.sourcePage,
    review_status: e.reviewStatus,
    review_note: e.reviewNote,
    metadata: e.metadata as Json,
  };
}

export function rowToEdge(r: EdgeRow): GraphEdge {
  return {
    id: r.id,
    graphId: r.graph_id,
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    answerLabel: r.answer_label,
    edgeKind: r.edge_kind,
    orderIndex: r.order_index,
    sourcePage: r.source_page,
    reviewStatus: r.review_status,
    reviewNote: r.review_note,
    metadata: r.metadata ?? {},
  };
}

export function graphDataToRows(data: GraphData): { graph: GraphRow; nodes: NodeRow[]; edges: EdgeRow[]; characters: CharacterRow[] } {
  return {
    graph: graphToRow(data.graph),
    nodes: data.nodes.map(nodeToRow),
    edges: data.edges.map(edgeToRow),
    characters: data.characters.map(characterToRow),
  };
}

export function snapshotToGraphData(snapshot: DbSnapshot): GraphData {
  if (!snapshot.graph) throw new Error('snapshot has no graph row');
  return {
    graph: rowToGraph(snapshot.graph),
    nodes: snapshot.nodes.map(rowToNode),
    edges: snapshot.edges.map(rowToEdge),
    characters: snapshot.characters.map(rowToCharacter),
  };
}

/** Rows an admin created by hand: no book key, or explicitly tagged. The importer never touches them. */
export function isAdminRow(row: { node_key?: string | null; metadata?: Json | null }): boolean {
  if (row.metadata && (row.metadata as Json).origin === 'admin') return true;
  return row.node_key === null || row.node_key === '';
}

export function isAdminEdgeRow(row: EdgeRow): boolean {
  return !!row.metadata && row.metadata.origin === 'admin';
}
