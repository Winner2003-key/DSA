import { describe, expect, it } from 'vitest';
import { fromGraphData, fromNode, toGraphData, toNode, type NodeRow } from '../src/lib/rows';
import { miniGraph } from './helpers';

describe('row ⇄ GraphData mapping', () => {
  it('round-trips the whole mini graph without losing a field', () => {
    const data = miniGraph();
    const rows = fromGraphData(data);
    expect(toGraphData(rows)).toEqual(data);
  });

  it('uses the snake_case column names of DATABASE_SCHEMA.md', () => {
    const data = miniGraph();
    const rows = fromGraphData(data);
    const character = data.nodes.find((n) => n.nodeType === 'CHARACTER')!;
    const row = rows.nodes.find((r) => r.id === character.id)!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'character_id', 'description', 'graph_id', 'id', 'label', 'metadata', 'node_key', 'node_type',
        'position_x', 'position_y', 'question', 'review_note', 'review_status', 'source_page',
      ].sort(),
    );
    expect(row.node_key).toBe(character.nodeKey);
    expect(row.character_id).toBe(character.characterId);
    expect(Object.keys(rows.edges[0]!)).toContain('order_index');
    expect(Object.keys(rows.characters[0]!)).toContain('name_fr');
    expect(rows.graph.is_active).toBe(true);
  });

  it('keeps edge source_variants and node metadata intact', () => {
    const data = miniGraph();
    const withVariants = data.edges.find((e) => (e.metadata.source_variants?.length ?? 0) > 0)!;
    const back = toGraphData(fromGraphData(data)).edges.find((e) => e.id === withVariants.id)!;
    expect(back.metadata.source_variants).toEqual(withVariants.metadata.source_variants);
  });

  it('narrows unexpected enum values and null metadata from the database', () => {
    const row: NodeRow = {
      ...fromNode(miniGraph().nodes[0]!),
      node_type: 'SOMETHING',
      review_status: 'WHATEVER',
      metadata: null,
    };
    const mapped = toNode(row);
    expect(mapped.nodeType).toBe('CATEGORY');
    expect(mapped.reviewStatus).toBe('DRAFT');
    expect(mapped.metadata).toEqual({});
  });
});
