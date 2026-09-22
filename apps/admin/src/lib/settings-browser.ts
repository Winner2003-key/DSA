'use client';

import { MOCK_MODE } from './env';
import { createSupabaseSettingsRepository, type SettingsRepository } from './settings-repository';
import { getBrowserClient } from './supabase/client';

let cached: SettingsRepository | null = null;

export async function getBrowserSettingsRepository(): Promise<SettingsRepository> {
  if (cached) return cached;
  if (MOCK_MODE) {
    const { createMockSettingsRepository } = await import('./settings-repository');
    cached = createMockSettingsRepository();
  } else {
    cached = createSupabaseSettingsRepository(getBrowserClient());
  }
  return cached;
}
