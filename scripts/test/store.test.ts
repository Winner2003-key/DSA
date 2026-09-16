import { describe, expect, it } from 'vitest';
import { ID_FILTER_CHUNK, chunkIds } from '../src/store';

describe('id filters sent to Supabase', () => {
  const ids = Array.from({ length: 1157 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

  it('never puts more than ID_FILTER_CHUNK ids in one request', () => {
    const groups = chunkIds(ids);
    expect(groups.every((g) => g.length <= ID_FILTER_CHUNK)).toBe(true);
    expect(groups.flat()).toEqual(ids);
  });

  it('keeps each filter URL well under the size Supabase rejects ("Bad Request")', () => {
    // `id=in.(uuid,uuid,…)`: 36 characters per uuid plus a comma.
    for (const group of chunkIds(ids)) expect(`id=in.(${group.join(',')})`.length).toBeLessThan(4000);
  });

  it('returns no groups for no ids', () => {
    expect(chunkIds([])).toEqual([]);
  });
});
