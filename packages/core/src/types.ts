// Shared types for @dsa/core. Mirrors GRAPH_SPECIFICATION.md §4.

export type NodeType = 'START' | 'QUESTION' | 'CATEGORY' | 'GROUP' | 'CHARACTER' | 'REFERENCE' | 'END';
export type EdgeKind = 'DECISION' | 'HIERARCHY' | 'SYSTEM';
export type ReviewStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
export type GroupKind = 'CLASSE' | 'TOME' | 'ALIAS' | 'OTHER';
export type AnswerClass = 'OUI' | 'NON' | 'OUI_REPETE' | 'NON_REPETE' | 'JE_NE_SAIS_PAS' | 'AUTRE';
export type GameMode = 'HUMAN_VS_HUMAN' | 'AI_TIREUR' | 'AI_DECOUVREUR' | 'LOCAL';
export type Role = 'TIREUR' | 'DECOUVREUR';
export type SessionStatus = 'WAITING' | 'READY' | 'PLAYING' | 'DISCOVERED' | 'ABANDONED';
export type Awaiting = 'QUESTION' | 'ANSWER' | 'GUESS_CONFIRM' | 'NONE';
export type GraphStatus = 'DRAFT' | 'PUBLISHED';

export const NODE_TYPES: readonly NodeType[] = ['START', 'QUESTION', 'CATEGORY', 'GROUP', 'CHARACTER', 'REFERENCE', 'END'];

// ---------------------------------------------------------------------------
// Graph data

export interface Graph {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  isActive: boolean;
  status: GraphStatus;
  sourceDocument: string | null;
}

export interface NodeMetadata {
  printed_page?: number;
  extra_pages?: number[];
  group_kind?: GroupKind;
  qualifier?: string;
  target_node_key?: string;
  notes?: string[];
  variants?: string[];
  [k: string]: unknown;
}

export interface GraphNode {
  id: string;
  graphId: string;
  nodeKey: string;
  nodeType: NodeType;
  label: string;
  question: string | null;
  description: string | null;
  characterId: string | null;
  sourcePage: number | null;
  positionX: number | null;
  positionY: number | null;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  metadata: NodeMetadata;
}

export interface SourceVariant {
  label: string;
  page: number;
}

export interface EdgeMetadata {
  source_variants?: SourceVariant[];
  notes?: string[];
  [k: string]: unknown;
}

export interface GraphEdge {
  id: string;
  graphId: string;
  fromNodeId: string;
  toNodeId: string;
  answerLabel: string;
  edgeKind: EdgeKind;
  orderIndex: number;
  sourcePage: number | null;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  metadata: EdgeMetadata;
}

export interface BibleCharacter {
  id: string;
  name: string;
  nameFr: string | null;
  nameEn: string | null;
  gender: 'M' | 'F' | null;
  testament: 'ANCIEN' | 'NOUVEAU' | null;
  description: string | null;
  aliases: string[];
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export interface GraphData {
  graph: Graph;
  nodes: GraphNode[];
  edges: GraphEdge[];
  characters: BibleCharacter[];
}

// ---------------------------------------------------------------------------
// Rules and engine

/** An answered step. `index` is its position in the list of answered steps. */
export interface Step {
  index: number;
  promptNodeId: string;
  answerLabel: string;
}

export interface Position {
  nodeId: string;
  childCursor: number;
}

export interface Prompt {
  /** SPINE: the QUESTION node itself. CHILD: the child being asked about. */
  promptNodeId: string;
  /** The node the game is at (QUESTION, or the CATEGORY/GROUP whose children are asked). */
  atNodeId: string;
  text: string;
  kind: 'SPINE' | 'CHILD';
  answerClasses: AnswerClass[];
}

export type MoveType = 'QUESTION' | 'ANSWER' | 'GUESS' | 'GUESS_CONFIRM' | 'BACK' | 'REWIND' | 'SYSTEM';

export type EngineMove =
  | { type: 'SYSTEM'; at: string; event: 'START'; secretNodeId: string }
  | { type: 'QUESTION'; at: string; promptNodeId: string; text: string }
  | {
      type: 'ANSWER';
      at: string;
      stepIndex: number;
      promptNodeId: string;
      answerLabel: string;
      answerClass: AnswerClass;
      /** The truthful answer class at that moment (null if no secret). Used for stats. */
      expectedClass: AnswerClass | null;
    }
  | { type: 'GUESS'; at: string; name: string }
  | { type: 'GUESS_CONFIRM'; at: string; name: string; answerLabel: 'OUI' | 'NON' }
  | { type: 'BACK'; at: string; stepIndex: number; undoneCount: number }
  | { type: 'REWIND'; at: string; count: 1 | 2 | 3; undoneCount: number };

export interface EngineState {
  status: SessionStatus;
  awaiting: Awaiting;
  steps: Step[];
  undoneSteps: Step[];
  pendingGuess: string | null;
  moves: EngineMove[];
  secretNodeId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export type DecouvreurAction = { type: 'ASK' } | { type: 'GUESS'; name: string } | { type: 'BACK'; stepIndex: number };

export type PathStep =
  | {
      kind: 'STEP';
      index: number;
      promptNodeId: string;
      promptKind: 'SPINE' | 'CHILD';
      /** Type of the prompt node (QUESTION for SPINE; CATEGORY, GROUP or CHARACTER for CHILD). */
      nodeType: NodeType;
      text: string;
      answerLabel: string;
      answerClass: AnswerClass;
      /**
       * SPINE only: the prompt text of the node the answer entered (a section, or the next
       * spine question). null for CHILD steps. Mirrors `path[].target_text` (§8).
       */
      targetText: string | null;
    }
  | { kind: 'NAME'; nodeId: string; name: string; description: string | null };

export interface GameStats {
  questions: number;
  answers: number;
  nonAnswers: number;
  /** ANSWER moves whose class differed from the truthful class. */
  wrongAnswers: number;
  guesses: number;
  wrongGuesses: number;
  rewinds: number;
  backs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Intents

export type Intent =
  | { type: 'ASK'; confidence: number }
  | { type: 'GUESS'; name: string; confidence: number }
  | { type: 'BACK'; stepIndex?: number }
  | { type: 'ANSWER'; label: string }
  | { type: 'REWIND'; count: 1 | 2 | 3 }
  | { type: 'UNKNOWN' };

export interface IntentContext {
  role: Role;
  prompt: Prompt | null;
  answerLabels: string[];
  knownNames: string[];
  path: { index: number; text: string }[];
}

// ---------------------------------------------------------------------------
// Validator

export type ValidationCode =
  | 'EDGE_MISSING_NODE'
  | 'START_COUNT'
  | 'NO_OUTGOING'
  | 'EDGE_KIND_MISMATCH'
  | 'CHARACTER_WITHOUT_CHARACTER_ID'
  | 'CHARACTER_ID_UNKNOWN'
  | 'CHARACTER_HAS_OUTGOING'
  | 'DUPLICATE_EDGE'
  | 'DUPLICATE_ORDER_INDEX'
  | 'DUPLICATE_ANSWER_CLASS'
  | 'DECISION_LABEL_UNKNOWN'
  | 'ORPHAN_NODE'
  | 'UNREACHABLE_NODE'
  | 'MULTIPLE_PARENTS'
  | 'CYCLE'
  | 'UNRESOLVED_REFERENCE'
  | 'SHARED_CHARACTER_LABEL';

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: ValidationCode;
  message: string;
  nodeKeys: string[];
}

export interface ValidationStats {
  nodes: number;
  edges: number;
  characters: number;
  nodesByType: Record<NodeType, number>;
  needsReviewNodes: number;
  needsReviewEdges: number;
  playableCharacters: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  stats: ValidationStats;
}

// ---------------------------------------------------------------------------
// Book transcription parser

export interface ParseError {
  file: string;
  line: number;
  message: string;
}

export interface ParsedTag {
  name: string;
  value: string | null;
}

export interface ParsedSpineNode {
  line: number;
  /** null for the START line. */
  answerLabel: string | null;
  edgeTags: ParsedTag[];
  nodeType: NodeType;
  label: string;
  nodeTags: ParsedTag[];
  pages: number[];
  children: ParsedSpineNode[];
}

export interface ParsedSpine {
  fileName: string;
  root: ParsedSpineNode | null;
  errors: ParseError[];
}

export interface ParsedTreeItem {
  line: number;
  kind: 'CATEGORY' | 'CHARACTER';
  /** CATEGORY/GROUP: the label. CHARACTER: the name. */
  label: string;
  /** CHARACTER only: the clue (null when the line has no clue). */
  clue: string | null;
  groupKind: GroupKind | null;
  tags: ParsedTag[];
  pages: number[];
  children: ParsedTreeItem[];
}

export interface ParsedAttach {
  key: string;
  line: number;
  items: ParsedTreeItem[];
}

export interface ParsedPage {
  fileName: string;
  page: number | null;
  printed: number | null;
  attaches: ParsedAttach[];
  errors: ParseError[];
}

export type BuildIssueCode =
  | 'PARSE_ERROR'
  | 'UNRESOLVED_ATTACH'
  | 'INVALID_ATTACH_TARGET'
  | 'DUPLICATE_KEY'
  | 'KEY_COLLISION'
  | 'UNRESOLVED_SAME_AS'
  | 'INVALID_ALIAS_GROUP'
  | 'EMPTY_CATEGORY';

export interface BuildIssue {
  code: BuildIssueCode;
  message: string;
  file: string | null;
  line: number | null;
}

export interface BuildReport {
  errors: BuildIssue[];
  warnings: BuildIssue[];
  stats: { pages: number; nodes: number; edges: number; characters: number };
}

export interface BuildOptions {
  defaultReviewStatus?: ReviewStatus;
  graphName?: string;
  graphStatus?: GraphStatus;
  sourceDocument?: string | null;
  /** Private salt mixed into node, edge and character ids (GRAPH_SPECIFICATION.md §7). */
  idSalt?: string | null;
  /** Tests and local checks only: build a real graph without a salt instead of throwing. */
  allowUnsalted?: boolean;
}
