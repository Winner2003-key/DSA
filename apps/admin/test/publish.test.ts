import { describe, expect, it } from 'vitest';
import { checkPublishable } from '../src/lib/publish';
import { byLabel, miniGraph } from './helpers';

describe('publish check', () => {
  it('allows a valid graph, even with warnings', () => {
    const result = checkPublishable(miniGraph());
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Graphe publié');
  });

  it('refuses a graph with validation errors and returns them', () => {
    const data = miniGraph();
    const adam = byLabel(data, 'ADAM');
    adam.characterId = null; // CHARACTER_WITHOUT_CHARACTER_ID
    const result = checkPublishable(data);
    expect(result.ok).toBe(false);
    expect(result.title).toBe('Publication refusée');
    expect(result.errors.map((issue) => issue.code)).toContain('CHARACTER_WITHOUT_CHARACTER_ID');
    expect(result.report).toContain('CHARACTER_WITHOUT_CHARACTER_ID');
  });
});
