// DSA — Edge Function `livekit-token` (Supabase, Deno). Thin wrapper: all the logic is in core.ts.
// Deploy: see VOICE.md, "Appel dans une salle". Secrets: LIVEKIT_URL, LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase).

import { handleLiveKitToken } from './core.ts';

const env = {
  LIVEKIT_URL: Deno.env.get('LIVEKIT_URL'),
  LIVEKIT_API_KEY: Deno.env.get('LIVEKIT_API_KEY'),
  LIVEKIT_API_SECRET: Deno.env.get('LIVEKIT_API_SECRET'),
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_PUBLISHABLE_KEYS: Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
};

Deno.serve((req) =>
  handleLiveKitToken(req, {
    env,
    fetch,
    // Metadata only: status, timings, the step that refused. Never tokens, keys or names.
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  }),
);
