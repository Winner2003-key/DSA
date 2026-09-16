import { answerClass } from './answers';
import { GraphIndex } from './graph-index';
import { normalizeName } from './normalize';
import { NODE_TYPES } from './types';
import type { GraphData, GraphEdge, GraphNode, NodeType, ValidationCode, ValidationIssue, ValidationReport } from './types';

export function validateGraph(data: GraphData): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const error = (code: ValidationCode, message: string, nodeKeys: string[] = []) => errors.push({ severity: 'ERROR', code, message, nodeKeys });
  const warn = (code: ValidationCode, message: string, nodeKeys: string[] = []) => warnings.push({ severity: 'WARNING', code, message, nodeKeys });

  const byId = new Map<string, GraphNode>();
  for (const n of data.nodes) byId.set(n.id, n);
  const characterIds = new Set(data.characters.map((c) => c.id));
  const describe = (n: GraphNode) => `${n.nodeType} "${n.label}" (${n.nodeKey})`;
  const keyOf = (id: string) => byId.get(id)?.nodeKey ?? id;

  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const e of data.edges) {
    const from = byId.get(e.fromNodeId);
    const to = byId.get(e.toNodeId);
    if (!from || !to) {
      const missing = [!from ? `from ${e.fromNodeId}` : null, !to ? `to ${e.toNodeId}` : null].filter(Boolean).join(', ');
      error('EDGE_MISSING_NODE', `edge ${e.id} "${e.answerLabel}" points to a missing node (${missing})`, [from?.nodeKey, to?.nodeKey].filter((k): k is string => !!k));
      continue;
    }
    push(out, e.fromNodeId, e);
    push(inc, e.toNodeId, e);
  }
  for (const list of out.values()) list.sort((a, b) => a.orderIndex - b.orderIndex);

  const starts = data.nodes.filter((n) => n.nodeType === 'START');
  if (starts.length !== 1) error('START_COUNT', `expected exactly 1 START node, found ${starts.length}`, starts.map((n) => n.nodeKey));

  for (const n of data.nodes) {
    const edges = out.get(n.id) ?? [];
    if (n.nodeType === 'CHARACTER') {
      if (n.characterId === null) error('CHARACTER_WITHOUT_CHARACTER_ID', `${describe(n)} has no characterId`, [n.nodeKey]);
      else if (!characterIds.has(n.characterId)) error('CHARACTER_ID_UNKNOWN', `${describe(n)} references unknown character ${n.characterId}`, [n.nodeKey]);
      if (edges.length > 0) error('CHARACTER_HAS_OUTGOING', `${describe(n)} has ${edges.length} outgoing edge(s)`, [n.nodeKey]);
      continue;
    }
    if (n.nodeType === 'REFERENCE') error('UNRESOLVED_REFERENCE', `${describe(n)} is an unresolved reference`, [n.nodeKey]);
    if (edges.length === 0 && n.nodeType !== 'END') error('NO_OUTGOING', `${describe(n)} has no outgoing edge`, [n.nodeKey]);

    const expected = expectedEdgeKind(n.nodeType);
    if (expected) {
      for (const e of edges) {
        if (e.edgeKind !== expected) {
          error('EDGE_KIND_MISMATCH', `${describe(n)} has a ${e.edgeKind} edge "${e.answerLabel}" to ${keyOf(e.toNodeId)}; expected ${expected}`, [n.nodeKey, keyOf(e.toNodeId)]);
        }
      }
    }

    const pairs = new Set<string>();
    const orders = new Set<number>();
    const classes = new Map<string, GraphEdge>();
    for (const e of edges) {
      if (pairs.has(e.toNodeId)) error('DUPLICATE_EDGE', `duplicate edge ${n.nodeKey} -> ${keyOf(e.toNodeId)}`, [n.nodeKey, keyOf(e.toNodeId)]);
      pairs.add(e.toNodeId);
      if (orders.has(e.orderIndex)) error('DUPLICATE_ORDER_INDEX', `${describe(n)} has several edges with orderIndex ${e.orderIndex}`, [n.nodeKey]);
      orders.add(e.orderIndex);
      if (e.edgeKind === 'DECISION') {
        const cls = answerClass(e.answerLabel);
        // Spec §7: a playable branch must carry an answer the players can actually give.
        if (cls === 'AUTRE' && e.reviewStatus === 'APPROVED') {
          error(
            'DECISION_LABEL_UNKNOWN',
            `${describe(n)} has an APPROVED DECISION edge to ${keyOf(e.toNodeId)} whose answer "${e.answerLabel}" is not a known code (OUI, NON, OUIOUIOUI, NONONONON, JE NE SAIS PAS)`,
            [n.nodeKey, keyOf(e.toNodeId)],
          );
        }
        const classKey = cls === 'AUTRE' ? `AUTRE:${normalizeName(e.answerLabel)}` : cls;
        const previous = classes.get(classKey);
        if (previous) {
          error('DUPLICATE_ANSWER_CLASS', `${describe(n)} has two ${cls} answers: "${previous.answerLabel}" and "${e.answerLabel}"`, [n.nodeKey]);
        } else classes.set(classKey, e);
      }
    }
  }

  const dupIds = duplicates(data.edges.map((e) => e.id));
  for (const id of dupIds) error('DUPLICATE_EDGE', `edge id ${id} is used more than once`);

  // Reachability, orphans, multiple parents.
  const reached = new Set<string>();
  const stack = starts.map((s) => s.id);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const e of out.get(id) ?? []) stack.push(e.toNodeId);
  }
  for (const n of data.nodes) {
    const parents = inc.get(n.id) ?? [];
    if (n.nodeType !== 'START' && parents.length === 0) error('ORPHAN_NODE', `${describe(n)} has no incoming edge`, [n.nodeKey]);
    else if (!reached.has(n.id)) error('UNREACHABLE_NODE', `${describe(n)} is not reachable from START`, [n.nodeKey]);
    if (parents.length > 1) warn('MULTIPLE_PARENTS', `${describe(n)} has ${parents.length} parents: ${parents.map((e) => keyOf(e.fromNodeId)).join(', ')}`, [n.nodeKey]);
  }

  for (const id of findCycleNodes(data.nodes, out)) {
    const n = byId.get(id) as GraphNode;
    error('CYCLE', `${describe(n)} is part of a cycle`, [n.nodeKey]);
  }

  // Shared CHARACTER labels (different people with the same name).
  const byLabel = new Map<string, GraphNode[]>();
  for (const n of data.nodes) if (n.nodeType === 'CHARACTER') push(byLabel, normalizeName(n.label), n);
  const characterDescriptions = new Map(data.characters.map((c) => [c.id, c.description]));
  for (const nodes of byLabel.values()) {
    const people = new Set(nodes.map((n) => n.characterId ?? `node:${n.id}`));
    if (people.size < 2) continue;
    const first = nodes[0] as GraphNode;
    const descriptions = nodes.map((n) => (n.characterId && characterDescriptions.get(n.characterId)) || n.description || n.nodeKey);
    warn('SHARED_CHARACTER_LABEL', `name "${first.label}" is shared by ${people.size} characters: ${descriptions.join(' | ')}`, nodes.map((n) => n.nodeKey));
  }

  const nodesByType = Object.fromEntries(NODE_TYPES.map((t) => [t, 0])) as Record<NodeType, number>;
  for (const n of data.nodes) nodesByType[n.nodeType]++;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodes: data.nodes.length,
      edges: data.edges.length,
      characters: data.characters.length,
      nodesByType,
      needsReviewNodes: data.nodes.filter((n) => n.reviewStatus === 'NEEDS_REVIEW').length,
      needsReviewEdges: data.edges.filter((e) => e.reviewStatus === 'NEEDS_REVIEW').length,
      playableCharacters: new GraphIndex(data).playableCharacters().length,
    },
  };
}

export interface FormatReportOptions {
  /** Print at most this many issues per code, then "… and N more". Default: all. */
  maxIssuesPerCode?: number;
}

export function formatReport(report: ValidationReport, opts: FormatReportOptions = {}): string {
  const s = report.stats;
  const byType = NODE_TYPES.filter((t) => s.nodesByType[t] > 0)
    .map((t) => `${t} ${s.nodesByType[t]}`)
    .join(', ');
  const lines = [
    `✓ ${s.nodes} nodes (${byType})`,
    `✓ ${s.edges} edges`,
    `✓ ${s.characters} characters`,
    `${s.playableCharacters > 0 ? '✓' : '⚠'} ${s.playableCharacters} playable characters`,
    `${s.needsReviewNodes + s.needsReviewEdges > 0 ? '⚠' : '✓'} ${s.needsReviewNodes} nodes and ${s.needsReviewEdges} edges NEEDS_REVIEW`,
  ];
  const max = opts.maxIssuesPerCode ?? Number.POSITIVE_INFINITY;
  const emit = (issues: ValidationIssue[], prefix: string) => {
    const seen = new Map<ValidationCode, number>();
    for (const issue of issues) {
      const count = (seen.get(issue.code) ?? 0) + 1;
      seen.set(issue.code, count);
      if (count <= max) lines.push(`${prefix}: [${issue.code}] ${issue.message}`);
    }
    for (const [code, count] of seen) if (count > max) lines.push(`${prefix}: [${code}] … and ${count - max} more`);
  };
  emit(report.errors, 'ERROR');
  emit(report.warnings, 'WARNING');
  lines.push(
    report.ok
      ? `✓ valid (0 errors, ${report.warnings.length} warnings)`
      : `✗ ${report.errors.length} errors, ${report.warnings.length} warnings`,
  );
  return lines.join('\n');
}

function expectedEdgeKind(type: NodeType): GraphEdge['edgeKind'] | null {
  switch (type) {
    case 'START':
      return 'SYSTEM';
    case 'QUESTION':
      return 'DECISION';
    case 'CATEGORY':
    case 'GROUP':
      return 'HIERARCHY';
    default:
      return null;
  }
}

/** Nodes on a cycle (iterative DFS; every node on the stack between the back-edge target and the top). */
function findCycleNodes(nodes: GraphNode[], out: Map<string, GraphEdge[]>): string[] {
  const state = new Map<string, 1 | 2>();
  const inCycle = new Set<string>();
  for (const root of nodes) {
    if (state.has(root.id)) continue;
    const path: string[] = [];
    const iters: number[] = [];
    state.set(root.id, 1);
    path.push(root.id);
    iters.push(0);
    while (path.length > 0) {
      const top = path.length - 1;
      const id = path[top] as string;
      const edges = out.get(id) ?? [];
      const i = iters[top] as number;
      if (i >= edges.length) {
        state.set(id, 2);
        path.pop();
        iters.pop();
        continue;
      }
      iters[top] = i + 1;
      const next = (edges[i] as GraphEdge).toNodeId;
      const st = state.get(next);
      if (st === 1) {
        for (let j = path.indexOf(next); j < path.length; j++) inCycle.add(path[j] as string);
      } else if (st === undefined) {
        state.set(next, 1);
        path.push(next);
        iters.push(0);
      }
    }
  }
  return [...inCycle];
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dup.add(v);
    seen.add(v);
  }
  return [...dup];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
