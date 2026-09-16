/**
 * Supabase row shapes (snake_case) and the mapping to the camelCase types of
 * `@dsa/core`. Nothing outside this file and `graph-repository.ts` should know
 * that the database spells things differently from the graph model.
 *
 * Column lists follow DATABASE_SCHEMA.md §1 "Graph tables".
 */
import type {
  BibleCharacter,
  EdgeKind,
  EdgeMetadata,
  Graph,
  GraphData,
  GraphEdge,
  GraphNode,
  GraphStatus,
  NodeMetadata,
  NodeType,
  ReviewStatus,
} from '@dsa/core';

export interface GraphRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
  status: string;
  source_document: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NodeRow {
  id: string;
  graph_id: string;
  node_key: string;
  node_type: string;
  label: string;
  question: string | null;
  description: string | null;
  character_id: string | null;
  source_page: number | null;
  position_x: number | null;
  position_y: number | null;
  review_status: string;
  review_note: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EdgeRow {
  id: string;
  graph_id: string;
  from_node_id: string;
  to_node_id: string;
  answer_label: string;
  edge_kind: string;
  order_index: number;
  source_page: number | null;
  review_status: string;
  review_note: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CharacterRow {
  id: string;
  name: string;
  name_fr: string | null;
  name_en: string | null;
  gender: string | null;
  testament: string | null;
  description: string | null;
  aliases: string[] | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
}

export const GRAPH_COLUMNS = 'id, slug, name, description, version, is_active, status, source_document, metadata';
export const NODE_COLUMNS =
  'id, graph_id, node_key, node_type, label, question, description, character_id, source_page, position_x, position_y, review_status, review_note, metadata';
export const EDGE_COLUMNS =
  'id, graph_id, from_node_id, to_node_id, answer_label, edge_kind, order_index, source_page, review_status, review_note, metadata';
export const CHARACTER_COLUMNS = 'id, name, name_fr, name_en, gender, testament, description, aliases, is_active, metadata';

const NODE_TYPE_VALUES: readonly string[] = ['START', 'QUESTION', 'CATEGORY', 'GROUP', 'CHARACTER', 'REFERENCE', 'END'];
const EDGE_KIND_VALUES: readonly string[] = ['DECISION', 'HIERARCHY', 'SYSTEM'];
const REVIEW_STATUS_VALUES: readonly string[] = ['DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'];

/**
 * The CHECK constraints keep these columns inside their enum, but a row read
 * back from the database is still `string` to TypeScript. Narrow it here rather
 * than casting at every call site, and fall back to the safest value.
 */
function asNodeType(value: string): NodeType {
  return (NODE_TYPE_VALUES.includes(value) ? value : 'CATEGORY') as NodeType;
}

function asEdgeKind(value: string): EdgeKind {
  return (EDGE_KIND_VALUES.includes(value) ? value : 'HIERARCHY') as EdgeKind;
}

function asReviewStatus(value: string): ReviewStatus {
  return (REVIEW_STATUS_VALUES.includes(value) ? value : 'DRAFT') as ReviewStatus;
}

export function toGraph(row: GraphRow): Graph {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: row.version,
    isActive: row.is_active,
    status: (row.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT') as GraphStatus,
    sourceDocument: row.source_document,
  };
}

export function fromGraph(graph: Graph): GraphRow {
  return {
    id: graph.id,
    slug: graph.slug,
    name: graph.name,
    description: graph.description,
    version: graph.version,
    is_active: graph.isActive,
    status: graph.status,
    source_document: graph.sourceDocument,
  };
}

export function toNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    graphId: row.graph_id,
    nodeKey: row.node_key,
    nodeType: asNodeType(row.node_type),
    label: row.label,
    question: row.question,
    description: row.description,
    characterId: row.character_id,
    sourcePage: row.source_page,
    positionX: row.position_x,
    positionY: row.position_y,
    reviewStatus: asReviewStatus(row.review_status),
    reviewNote: row.review_note,
    metadata: (row.metadata ?? {}) as NodeMetadata,
  };
}

export function fromNode(node: GraphNode): NodeRow {
  return {
    id: node.id,
    graph_id: node.graphId,
    node_key: node.nodeKey,
    node_type: node.nodeType,
    label: node.label,
    question: node.question,
    description: node.description,
    character_id: node.characterId,
    source_page: node.sourcePage,
    position_x: node.positionX,
    position_y: node.positionY,
    review_status: node.reviewStatus,
    review_note: node.reviewNote,
    metadata: node.metadata,
  };
}

export function toEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    graphId: row.graph_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    answerLabel: row.answer_label,
    edgeKind: asEdgeKind(row.edge_kind),
    orderIndex: row.order_index,
    sourcePage: row.source_page,
    reviewStatus: asReviewStatus(row.review_status),
    reviewNote: row.review_note,
    metadata: (row.metadata ?? {}) as EdgeMetadata,
  };
}

export function fromEdge(edge: GraphEdge): EdgeRow {
  return {
    id: edge.id,
    graph_id: edge.graphId,
    from_node_id: edge.fromNodeId,
    to_node_id: edge.toNodeId,
    answer_label: edge.answerLabel,
    edge_kind: edge.edgeKind,
    order_index: edge.orderIndex,
    source_page: edge.sourcePage,
    review_status: edge.reviewStatus,
    review_note: edge.reviewNote,
    metadata: edge.metadata,
  };
}

export function toCharacter(row: CharacterRow): BibleCharacter {
  const gender = row.gender === 'M' || row.gender === 'F' ? row.gender : null;
  const testament = row.testament === 'ANCIEN' || row.testament === 'NOUVEAU' ? row.testament : null;
  return {
    id: row.id,
    name: row.name,
    nameFr: row.name_fr,
    nameEn: row.name_en,
    gender,
    testament,
    description: row.description,
    aliases: row.aliases ?? [],
    isActive: row.is_active,
    metadata: row.metadata ?? {},
  };
}

export function fromCharacter(character: BibleCharacter): CharacterRow {
  return {
    id: character.id,
    name: character.name,
    name_fr: character.nameFr,
    name_en: character.nameEn,
    gender: character.gender,
    testament: character.testament,
    description: character.description,
    aliases: character.aliases,
    is_active: character.isActive,
    metadata: character.metadata,
  };
}

export interface GraphDataRows {
  graph: GraphRow;
  nodes: NodeRow[];
  edges: EdgeRow[];
  characters: CharacterRow[];
}

export function toGraphData(rows: GraphDataRows): GraphData {
  return {
    graph: toGraph(rows.graph),
    nodes: rows.nodes.map(toNode),
    edges: rows.edges.map(toEdge),
    characters: rows.characters.map(toCharacter),
  };
}

export function fromGraphData(data: GraphData): GraphDataRows {
  return {
    graph: fromGraph(data.graph),
    nodes: data.nodes.map(fromNode),
    edges: data.edges.map(fromEdge),
    characters: data.characters.map(fromCharacter),
  };
}
