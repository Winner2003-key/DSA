import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { DsaError } from './errors';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) throw new DsaError('CONFIG_MISSING');
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // The session is persisted so a player keeps their anonymous identity —
      // and therefore their running games — across restarts.
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      // There is no OAuth redirect in this app; parsing the URL would only
      // confuse expo-router's deep links.
      detectSessionInUrl: false,
    },
  });
  return client;
}

let signInPromise: Promise<void> | null = null;

/**
 * Every RPC requires `auth.uid()`; the `anon` role has no privileges at all
 * (DATABASE_SCHEMA.md §2). Anonymous sign-in must be enabled in the dashboard.
 */
export async function ensureSignedIn(): Promise<void> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  if (!signInPromise) {
    signInPromise = supabase.auth
      .signInAnonymously()
      .then(({ error }) => {
        if (error) throw error;
      })
      .finally(() => {
        signInPromise = null;
      });
  }
  await signInPromise;
}

/** Test seam: drops the memoised client so a mock can be installed. */
export function resetSupabaseForTests(): void {
  client = null;
  signInPromise = null;
}

/**
 * Realtime checks RLS with the player's own token (postgres_changes on the game
 * tables only reach players of the session), so sign in and hand the current
 * token to the Realtime client before opening any channel.
 */
export async function ensureRealtimeAuth(): Promise<SupabaseClient> {
  await ensureSignedIn();
  const supabase = getSupabase();
  await supabase.realtime.setAuth();
  return supabase;
}

