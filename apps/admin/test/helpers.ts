import type { GraphData, GraphEdge, GraphNode } from '@dsa/core';
import mini from '@dsa/core/fixtures/mini-graph.json';

/** A fresh deep copy of the core mini fixture (30 nodes, 29 edges, 12 characters). */
export function miniGraph(): GraphData {
  return structuredClone(mini as unknown as GraphData);
}

export function node(id: string, fields: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    graphId: 'g',
    nodeKey: id,
    nodeType: 'CATEGORY',
    label: id.toUpperCase(),
    question: null,
    description: null,
    characterId: null,
    sourcePage: 10,
    positionX: null,
    positionY: null,
    reviewStatus: 'APPROVED',
    reviewNote: null,
    metadata: {},
    ...fields,
  };
}

export function edge(from: string, to: string, orderIndex: number, fields: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: `${from}->${to}`,
    graphId: 'g',
    fromNodeId: from,
    toNodeId: to,
    answerLabel: 'OUI',
    edgeKind: 'HIERARCHY',
    orderIndex,
    sourcePage: 10,
    reviewStatus: 'APPROVED',
    reviewNote: null,
    metadata: {},
    ...fields,
  };
}

export function byLabel(data: GraphData, label: string): GraphNode {
  const found = data.nodes.find((n) => n.label === label);
  if (!found) throw new Error(`no node ${label}`);
  return found;
}
