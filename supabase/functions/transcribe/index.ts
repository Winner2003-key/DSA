// DSA — Edge Function `transcribe` (Supabase, Deno). Thin wrapper: all the logic is in core.ts.
// Deploy: see VOICE.md. Secrets: GROQ_API_KEY, HF_TOKEN (SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase).

import { handleTranscribe } from './core.ts';

const env = {
  GROQ_API_KEY: Deno.env.get('GROQ_API_KEY'),
  HF_TOKEN: Deno.env.get('HF_TOKEN'),
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_PUBLISHABLE_KEYS: Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'),
};

Deno.serve((req) =>
  handleTranscribe(req, {
    env,
    fetch,
    // Metadata only: status, provider, sizes and timings. Never audio, hints, transcripts or keys.
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  }),
);
