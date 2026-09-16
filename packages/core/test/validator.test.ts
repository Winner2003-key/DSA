import { describe, expect, it } from 'vitest';
import { formatReport, validateGraph } from '../src/index';
import type { BibleCharacter, EdgeKind, GraphData, GraphEdge, GraphNode, NodeType, ValidationCode } from '../src/index';
import { mini } from './helpers';

type N = [key: string, type: NodeType, extra?: Partial<GraphNode>];
type Ed = [from: string, to: string, kind: EdgeKind, label: string, order: number];

function graph(nodes: N[], edges: Ed[]): GraphData {
  const characters: BibleCharacter[] = [];
  const gNodes = nodes.map(([key, type, extra]): GraphNode => {
    const characterId = type === 'CHARACTER' ? `char:${key}` : null;
    if (characterId) {
      characters.push({ id: characterId, name: key.toUpperCase(), nameFr: null, nameEn: null, gender: null, testament: null, description: `desc ${key}`, aliases: [], isActive: true, metadata: {} });
    }
    return {
      id: key,
      graphId: 'g',
      nodeKey: key,
      nodeType: type,
      label: key.toUpperCase(),
      question: null,
      description: null,
      characterId,
      sourcePage: null,
      positionX: null,
      positionY: null,
      reviewStatus: 'APPROVED',
      reviewNote: null,
      metadata: {},
      ...extra,
    };
  });
  const gEdges = edges.map(([from, to, kind, label, order], i): GraphEdge => ({
    id: `e${i}:${from}->${to}`,
    graphId: 'g',
    fromNodeId: from,
    toNodeId: to,
    answerLabel: label,
    edgeKind: kind,
    orderIndex: order,
    sourcePage: null,
    reviewStatus: 'APPROVED',
    reviewNote: null,
    metadata: {},
  }));
  return { graph: { id: 'g', slug: 'g', name: 'g', description: null, version: 1, isActive: true, status: 'DRAFT', sourceDocument: null }, nodes: gNodes, edges: gEdges, characters };
}

const BASE_NODES: N[] = [
  ['s', 'START'],
  ['q', 'QUESTION'],
  ['c', 'CATEGORY'],
  ['x', 'CHARACTER'],
  ['y', 'CHARACTER'],
];
const BASE_EDGES: Ed[] = [
  ['s', 'q', 'SYSTEM', 'DÉBUT', 0],
  ['q', 'c', 'DECISION', 'OUI', 0],
  ['q', 'x', 'DECISION', 'NON', 1],
  ['c', 'y', 'HIERARCHY', 'OUI', 0],
];

const codes = (data: GraphData) => validateGraph(data).errors.map((e) => e.code);
const expectError = (data: GraphData, code: ValidationCode) => expect(codes(data)).toContain(code);

describe('validateGraph', () => {
  it('accepts a valid small graph and the mini fixture', () => {
    const report = validateGraph(graph(BASE_NODES, BASE_EDGES));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats).toMatchObject({ nodes: 5, edges: 4, characters: 2, playableCharacters: 2, needsReviewNodes: 0 });
    const m = validateGraph(mini().data);
    expect(m.errors).toEqual([]);
    expect(m.stats.playableCharacters).toBe(13);
  });

  it('EDGE_MISSING_NODE', () => expectError(graph(BASE_NODES, [...BASE_EDGES, ['c', 'ghost', 'HIERARCHY', 'OUI', 1]]), 'EDGE_MISSING_NODE'));

  it('START_COUNT', () => {
    expectError(graph([...BASE_NODES, ['s2', 'START']], [...BASE_EDGES, ['s2', 'q', 'SYSTEM', 'DÉBUT', 0]]), 'START_COUNT');
    expectError(graph(BASE_NODES.slice(1), BASE_EDGES.slice(1)), 'START_COUNT');
  });

  it('NO_OUTGOING', () => expectError(graph([...BASE_NODES, ['d', 'CATEGORY']], [...BASE_EDGES, ['c', 'd', 'HIERARCHY', 'OUI', 1]]), 'NO_OUTGOING'));

  it('EDGE_KIND_MISMATCH for QUESTION and CATEGORY', () => {
    const edges = BASE_EDGES.map((e): Ed => (e[0] === 'q' && e[1] === 'c' ? ['q', 'c', 'HIERARCHY', 'OUI', 0] : e));
    expectError(graph(BASE_NODES, edges), 'EDGE_KIND_MISMATCH');
    const edges2 = BASE_EDGES.map((e): Ed => (e[0] === 'c' ? ['c', 'y', 'DECISION', 'OUI', 0] : e));
    expectError(graph(BASE_NODES, edges2), 'EDGE_KIND_MISMATCH');
  });

  it('CHARACTER without characterId, or with outgoing edges', () => {
    const nodes = BASE_NODES.map((n): N => (n[0] === 'x' ? ['x', 'CHARACTER', { characterId: null }] : n));
    expectError(graph(nodes, BASE_EDGES), 'CHARACTER_WITHOUT_CHARACTER_ID');
    expectError(graph([...BASE_NODES, ['z', 'CHARACTER']], [...BASE_EDGES, ['x', 'z', 'HIERARCHY', 'OUI', 0]]), 'CHARACTER_HAS_OUTGOING');
  });

  it('DUPLICATE_EDGE and DUPLICATE_ORDER_INDEX', () => {
    expectError(graph(BASE_NODES, [...BASE_EDGES, ['c', 'y', 'HIERARCHY', 'OUI', 1]]), 'DUPLICATE_EDGE');
    expectError(graph([...BASE_NODES, ['z', 'CHARACTER']], [...BASE_EDGES, ['c', 'z', 'HIERARCHY', 'OUI', 0]]), 'DUPLICATE_ORDER_INDEX');
  });

  it('DUPLICATE_ANSWER_CLASS (repetition count is not significant)', () => {
    const nodes: N[] = [...BASE_NODES, ['z', 'CHARACTER'], ['w', 'CHARACTER']];
    const report = validateGraph(graph(nodes, [...BASE_EDGES, ['q', 'z', 'DECISION', 'OUIOUI', 2], ['q', 'w', 'DECISION', 'OUIOUIOUIOUI', 3]]));
    expect(report.errors.map((e) => e.code)).toEqual(['DUPLICATE_ANSWER_CLASS']);
    // Two distinct AUTRE labels are different answers, so they are not a duplicate class.
    const distinct = codes(graph(nodes, [...BASE_EDGES, ['q', 'z', 'DECISION', 'CODE A', 2], ['q', 'w', 'DECISION', 'CODE B', 3]]));
    expect(distinct).not.toContain('DUPLICATE_ANSWER_CLASS');
  });

  it('DECISION_LABEL_UNKNOWN only for APPROVED AUTRE decision edges (spec §7)', () => {
    const nodes: N[] = [...BASE_NODES, ['z', 'CHARACTER']];
    const withAutre = graph(nodes, [...BASE_EDGES, ['q', 'z', 'DECISION', 'CODE INCONNU (JOB)', 2]]);
    const report = validateGraph(withAutre);
    expect(report.errors.map((e) => e.code)).toEqual(['DECISION_LABEL_UNKNOWN']);
    expect(report.errors[0]?.message).toContain('CODE INCONNU (JOB)');
    expect(report.errors[0]?.nodeKeys).toEqual(['q', 'z']);
    expect(report.ok).toBe(false);

    // The same edge awaiting review is not an error: the admin still has to fix or approve it.
    const pending = graph(nodes, [...BASE_EDGES, ['q', 'z', 'DECISION', 'CODE INCONNU (JOB)', 2]]);
    (pending.edges[4] as GraphEdge).reviewStatus = 'NEEDS_REVIEW';
    expect(codes(pending)).toEqual([]);

    // Known codes stay valid whatever their spelling.
    for (const label of ['OUI', 'NON', 'OUIOUIOUI', 'NONONONON', 'JE NE SAIS PAS']) {
      const ok = graph([...BASE_NODES, ['k', 'CHARACTER']], [...BASE_EDGES, ['q', 'k', 'DECISION', label, 2]]);
      expect(codes(ok).filter((c) => c === 'DECISION_LABEL_UNKNOWN'), label).toEqual([]);
    }
  });

  it('ORPHAN_NODE and UNREACHABLE_NODE', () => {
    const report = validateGraph(graph([...BASE_NODES, ['o', 'CATEGORY'], ['w', 'CHARACTER']], [...BASE_EDGES, ['o', 'w', 'HIERARCHY', 'OUI', 0]]));
    expect(report.errors.find((e) => e.code === 'ORPHAN_NODE')?.nodeKeys).toEqual(['o']);
    expect(report.errors.find((e) => e.code === 'UNREACHABLE_NODE')?.nodeKeys).toEqual(['w']);
  });

  it('CYCLE', () => {
    const report = validateGraph(graph([...BASE_NODES, ['c2', 'CATEGORY']], [...BASE_EDGES, ['c', 'c2', 'HIERARCHY', 'OUI', 1], ['c2', 'c', 'HIERARCHY', 'OUI', 0]]));
    expect(report.errors.filter((e) => e.code === 'CYCLE').flatMap((e) => e.nodeKeys).sort()).toEqual(['c', 'c2']);
    expect(report.warnings.map((w) => w.code)).toContain('MULTIPLE_PARENTS');
  });

  it('UNRESOLVED_REFERENCE', () => expectError(graph([...BASE_NODES, ['r', 'REFERENCE']], [...BASE_EDGES, ['c', 'r', 'HIERARCHY', 'OUI', 1]]), 'UNRESOLVED_REFERENCE'));

  it('counts NEEDS_REVIEW and playable characters', () => {
    const nodes = BASE_NODES.map((n): N => (n[0] === 'x' ? ['x', 'CHARACTER', { reviewStatus: 'NEEDS_REVIEW' }] : n));
    const data = graph(nodes, BASE_EDGES);
    (data.edges[3] as GraphEdge).reviewStatus = 'NEEDS_REVIEW';
    const report = validateGraph(data);
    expect(report.stats).toMatchObject({ needsReviewNodes: 1, needsReviewEdges: 1, playableCharacters: 0 });
    expect(report.ok).toBe(true);
  });

  it('warns about CHARACTER labels shared by several characters, with descriptions', () => {
    const nodes = BASE_NODES.map((n): N => (n[1] === 'CHARACTER' ? [n[0], 'CHARACTER', { label: 'JACQUES' }] : n));
    const report = validateGraph(graph(nodes, BASE_EDGES));
    const warning = report.warnings.find((w) => w.code === 'SHARED_CHARACTER_LABEL');
    expect(warning?.message).toContain('desc x');
    expect(warning?.message).toContain('desc y');
    expect(warning?.nodeKeys).toEqual(['x', 'y']);
  });

  it('formatReport prints plain text', () => {
    const text = formatReport(validateGraph(graph([...BASE_NODES, ['d', 'CATEGORY']], [...BASE_EDGES, ['c', 'd', 'HIERARCHY', 'OUI', 1]])));
    expect(text).toContain('✓ 6 nodes (START 1, QUESTION 1, CATEGORY 2, CHARACTER 2)');
    expect(text).toContain('ERROR: [NO_OUTGOING] CATEGORY "D" (d) has no outgoing edge');
    expect(text.split('\n').at(-1)).toBe('✗ 1 errors, 0 warnings');
    const many = graph(
      [...BASE_NODES, ['d1', 'CATEGORY'], ['d2', 'CATEGORY'], ['d3', 'CATEGORY']],
      [...BASE_EDGES, ['c', 'd1', 'HIERARCHY', 'OUI', 1], ['c', 'd2', 'HIERARCHY', 'OUI', 2], ['c', 'd3', 'HIERARCHY', 'OUI', 3]],
    );
    expect(formatReport(validateGraph(many), { maxIssuesPerCode: 1 })).toContain('ERROR: [NO_OUTGOING] … and 2 more');
  });
});
