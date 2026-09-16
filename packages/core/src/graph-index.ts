import type { BibleCharacter, GraphData, GraphEdge, GraphNode } from './types';

export interface GraphIndexOptions {
  /** Only APPROVED nodes and edges are visible. Default true. */
  approvedOnly?: boolean;
}

/** Read-only lookup structure over GraphData. Children are sorted by orderIndex. */
export class GraphIndex {
  readonly data: GraphData;
  readonly approvedOnly: boolean;
  private readonly nodesById = new Map<string, GraphNode>();
  private readonly nodesByKey = new Map<string, GraphNode>();
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly incoming = new Map<string, GraphEdge[]>();
  private readonly charactersById = new Map<string, BibleCharacter>();
  private readonly startNode: GraphNode | null;

  constructor(data: GraphData, opts: GraphIndexOptions = {}) {
    this.data = data;
    this.approvedOnly = opts.approvedOnly ?? true;
    for (const n of data.nodes) {
      if (this.approvedOnly && n.reviewStatus !== 'APPROVED') continue;
      this.nodesById.set(n.id, n);
      this.nodesByKey.set(n.nodeKey, n);
    }
    for (const e of data.edges) {
      if (this.approvedOnly && e.reviewStatus !== 'APPROVED') continue;
      if (!this.nodesById.has(e.fromNodeId) || !this.nodesById.has(e.toNodeId)) continue;
      push(this.out, e.fromNodeId, e);
      push(this.incoming, e.toNodeId, e);
    }
    for (const list of this.out.values()) list.sort((a, b) => a.orderIndex - b.orderIndex);
    for (const c of data.characters) this.charactersById.set(c.id, c);
    this.startNode = [...this.nodesById.values()].find((n) => n.nodeType === 'START') ?? null;
  }

  node(id: string): GraphNode | undefined {
    return this.nodesById.get(id);
  }

  nodeByKey(key: string): GraphNode | undefined {
    return this.nodesByKey.get(key);
  }

  /** Like node(), but throws when the node is missing or not visible. */
  requireNode(id: string): GraphNode {
    const n = this.nodesById.get(id);
    if (!n) throw new Error(`Unknown node ${id}`);
    return n;
  }

  nodes(): GraphNode[] {
    return [...this.nodesById.values()];
  }

  start(): GraphNode {
    if (!this.startNode) throw new Error('Graph has no (approved) START node');
    return this.startNode;
  }

  outgoing(id: string): GraphEdge[] {
    return this.out.get(id) ?? [];
  }

  incomingEdges(id: string): GraphEdge[] {
    return this.incoming.get(id) ?? [];
  }

  parentEdge(id: string): GraphEdge | null {
    return this.incoming.get(id)?.[0] ?? null;
  }

  /** True when `ancestorId` is `nodeId` or lies on its parent chain. */
  isAncestorOrSelf(ancestorId: string, nodeId: string): boolean {
    const seen = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = this.parentEdge(current)?.fromNodeId ?? null;
    }
    return false;
  }

  /** CHARACTER nodes reachable from START, in book (depth-first, orderIndex) order. */
  playableCharacters(): GraphNode[] {
    if (!this.startNode) return [];
    const result: GraphNode[] = [];
    const seen = new Set<string>();
    const stack: string[] = [this.startNode.id];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = this.nodesById.get(id);
      if (!n) continue;
      if (n.nodeType === 'CHARACTER') result.push(n);
      const children = this.outgoing(id);
      for (let i = children.length - 1; i >= 0; i--) stack.push((children[i] as GraphEdge).toNodeId);
    }
    return result;
  }

  characterOf(nodeId: string): BibleCharacter | null {
    const n = this.nodesById.get(nodeId);
    if (!n || n.characterId === null) return null;
    return this.charactersById.get(n.characterId) ?? null;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
