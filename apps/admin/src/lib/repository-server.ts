import 'server-only';

import { MOCK_MODE } from './env';
import type { GraphRepository } from './graph-repository';
import { createSupabaseRepository } from './graph-repository';
import { getServerClient } from './supabase/server';

export async function getServerRepository(): Promise<GraphRepository> {
  if (MOCK_MODE) {
    const { createMockRepository } = await import('./mock-repository');
    return createMockRepository();
  }
  return createSupabaseRepository(await getServerClient());
}
