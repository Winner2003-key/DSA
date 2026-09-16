'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

let cached: SupabaseClient | null = null;

/** One browser client per tab; it owns the session cookies the server reads. */
export function getBrowserClient(): SupabaseClient {
  cached ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
