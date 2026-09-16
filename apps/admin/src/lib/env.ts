/**
 * The admin app only ever holds the two public Supabase values. The service
 * role key is never read here, never shipped to the browser and never set in
 * Vercel (DATABASE_SCHEMA.md §6, "Copy the API keys").
 */

/** Referenced literally so Next can inline them at build time. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Development-only: serve `packages/core/fixtures/mini-graph.json` from memory
 * and skip sign-in, so the editor can be opened without a database. Ignored in
 * a production build even if the variable is set.
 */
export const MOCK_MODE = process.env.NEXT_PUBLIC_DSA_MOCK === '1' && process.env.NODE_ENV !== 'production';

export const SUPABASE_CONFIGURED = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
