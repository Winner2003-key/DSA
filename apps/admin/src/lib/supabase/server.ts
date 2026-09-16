import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

/**
 * Server client for Server Components, Route Handlers and Server Actions.
 * Writing cookies throws inside a Server Component; the middleware has already
 * refreshed the session there, so that case is ignored on purpose.
 */
export async function getServerClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component render: the middleware refreshes the session instead.
        }
      },
    },
  });
}
