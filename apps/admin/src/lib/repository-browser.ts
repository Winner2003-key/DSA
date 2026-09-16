'use client';

import { MOCK_MODE } from './env';
import type { GraphRepository } from './graph-repository';
import { createSupabaseRepository } from './graph-repository';
import { getBrowserClient } from './supabase/client';

let cached: GraphRepository | null = null;

export async function getBrowserRepository(): Promise<GraphRepository> {
  if (cached) return cached;
  if (MOCK_MODE) {
    const { createMockRepository } = await import('./mock-repository');
    cached = createMockRepository();
  } else {
    cached = createSupabaseRepository(getBrowserClient());
  }
  return cached;
}
