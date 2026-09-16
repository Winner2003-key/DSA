# Brief S7a — Voice foundations: `packages/voice` + the `transcribe` Edge Function

You are a senior TypeScript engineer with audio signal-processing and Supabase Edge Functions (Deno) experience, on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game played by voice. Repo: `/home/winner/projects/DSA` (npm workspaces; Node 22).

**This session can run at the same time as S3b.** It doesn't touch `apps/mobile` or `packages/core`.

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no commit)
2. `GAME_RULES.md` (answer codes, and **"How questions are said"**)
3. `GRAPH_SPECIFICATION.md`, especially **§1 "Speech-to-text service" and "Recognising the Tireur's answers"**, §7 (canonical labels) and **§10 (direct phrasing, pronunciation, credentials)**
4. `DATABASE_SCHEMA.md`, `docs/sessions/reports/S1-core.md` (the intent matcher), `S2-database.md` (how SQL is verified without Docker), `S3-expo.md` §7
5. `packages/core/src/{answers,intents,normalize}.ts` (read-only dependency)

## You own
- `packages/voice/**` (new workspace `@dsa/voice`, pure TypeScript, no React Native or DOM; depends on `@dsa/core`);
- `supabase/functions/transcribe/**`;
- `supabase/migrations/0007_voice.sql` and `supabase/sql-editor/04_voice.sql`;
- a `VOICE.md` owner guide at the repo root.

**Do NOT run `build.sh` and do NOT edit `00_all_migrations.sql` or `90_tests.sql`** (S3b is editing them at the same time; S6 regenerates later). Put your SQL tests in `supabase/sql-editor/94_voice_tests.sql` (begin … rollback, same style as `90`).

`npm install` for your workspace only; on a lock or ENOTEMPTY error, wait 30 s and retry, and never delete the lockfile.

## Deliver

### 1. `@dsa/voice`: pure, fully unit-tested
- **`envelope.ts`: `analyzeEnvelope(samples: {tMs: number; db: number}[], opts?)`** → `{ voicedMs, bursts, longestBurstMs, noiseFloorDb, peakDb }`.
  - The input is a metering envelope: expo-audio metering on native (about every 50 ms, dBFS, −160…0) or a Web Audio RMS converted to dB.
  - Adaptive noise floor (low percentile), a voice threshold at floor + margin with hysteresis, bursts shorter than 60 ms dropped, gaps shorter than 80 ms merged, and separate bursts counted across gaps of 80–700 ms.
  - Export every constant.
- **`calibration.ts`:**
  - `calibrate(shortSamples: EnvelopeAnalysis[], longSamples: EnvelopeAnalysis[])` → `{ thresholdMs, shortMedianMs, longMedianMs, quality: 'good'|'weak' }`. The threshold is halfway between the medians, with a floor of 550 ms; `weak` if the medians are less than 250 ms apart.
  - `DEFAULT_CALIBRATION`.
- **`answer-decision.ts`: `decideAnswer({ allowedClasses, transcript, envelope, calibration, role })`**:
  - it returns `{ kind: 'ANSWER', label }`, `{ kind: 'CONFIRM', options: [labelA, labelB] }`, `{ kind: 'REWIND', count }` or `{ kind: 'UNKNOWN' }`;
  - the word comes from the transcript (via `@dsa/core` `matchIntent`): oui / non / je ne sais pas / question ×N;
  - **simple vs repeated comes from the sound** (§1): voiced length against `calibration.thresholdMs` (primary), or ≥2 bursts of the same word (secondary);
  - **borderline** (within ±15 % of the threshold) with both classes allowed → CONFIRM;
  - when the prompt doesn't allow a repeated class, it never returns one;
  - the result is always a **canonical book label** (`OUI`, `OUIOUIOUI`, `NON`, `NONONONON`, `JE NE SAIS PAS`);
  - transcript elongation hints ("ouiii", "oui oui oui", "nooon") are supporting evidence only.
- **`speakable.ts`:**
  - `speakablePrompt(text)` → the direct question for TTS (§10): no "Est-ce", the book label rewritten through a French **pronunciation lexicon** (`lexicon.fr.ts`: LIE A → lié à, EVANGILES → Évangiles, PROPHETES → prophètes, GENERATION → génération, MOISE → Moïse, ESAU → Ésaü, SAUL → Saül, ISRAEL → Israël, NEHEMIE → Néhémie, CHRONIQUES, ACTES DES APOTRES, EPITRES, 1ère/2ème classe, TOME 1 → "tome un", ordinals…), then sentence case plus " ?";
  - `speakableAnswer(label)` → "Oui." / "Non." / "Ouiiii !" / "Nonnnn !" / "Je ne sais pas.";
  - the lexicon is a plain data file, so the admin can edit it later.
- **`transcribe-client.ts`:** `SpeechToText` request and response types, and `buildTranscribeHint(prompt, knownNames)` (the current prompt label, plus at most ~40 of the most relevant names, kept under the Whisper prompt limit).
- **Tests (vitest), at least 60:**
  - synthetic envelopes: a short "oui" of 300 ms is 1 burst; a long "ouiiii" of 900 ms is 1 burst and long; "oui oui oui" is 3 bursts; background noise; a clipped start; a borderline case gives CONFIRM;
  - calibration math;
  - every `decideAnswer` branch, including "the prompt allows only OUI/NON, so the sound is ignored";
  - lexicon and phrasing examples: `ANCIEN` → "Ancien ?", `LIE A DAVID` → "Lié à David ?", `Le meurtrier` → "Le meurtrier ?".

### 2. Edge Function `supabase/functions/transcribe`
- **Structure:**
  - `index.ts` is a thin `Deno.serve` wrapper;
  - `core.ts` holds all the logic with `fetch` and the env injected, and uses **no Deno globals**, so vitest can test it from `packages/voice/test`.
- **Request:** `POST` multipart with `audio` (≤ 1.5 MB, ≤ 30 s; `audio/m4a|mp4|aac|webm|ogg|wav|mpeg`) and an optional `hint` (≤ 800 chars). Answer CORS preflight for the web app.
- **Auth:**
  - require the Supabase JWT (keep `verify_jwt` on);
  - resolve the user with the anon client and the request's Authorization header;
  - rate-limit through the RPC `dsa_voice_consume(p_audio_ms integer)`: SECURITY DEFINER, per user, for example 40 requests / 10 min and 900 s of audio / day, raising `DSA_VOICE_RATE_LIMIT`.
- **Primary provider: Groq** `whisper-large-v3-turbo`, `language=fr`, `prompt=hint`, `response_format=verbose_json`, with word timestamps if Groq supports them. **Check Groq's current API docs with WebFetch; don't assume.** 8 s timeout.
- **Fallback: Hugging Face Inference Providers** `openai/whisper-large-v3`, on a Groq timeout, 429 or 5xx. **Check the current endpoint and payload in HF's docs with WebFetch.**
- **Response:** `{ text, words?: [{word, startMs, endMs}], provider: 'groq'|'huggingface', durationMs }`. Errors are JSON `{ error: 'DSA_…', message_fr }` with proper status codes (401, 413, 415, 429, 502).
- **Never log** audio, transcripts or keys.
- **Secrets:** `GROQ_API_KEY`, `HF_TOKEN` (plus the `SUPABASE_URL` / `SUPABASE_ANON_KEY` that Supabase provides).
- **Handler tests** (mocked fetch): no JWT → 401; too large → 413; wrong type → 415; rate limited → 429; Groq ok; Groq 429 → HF; both fail → 502; the hint is truncated.
- **Real smoke test (optional).** If the owner has created the gitignored `supabase/functions/.env.local` with `GROQ_API_KEY` (and `HF_TOKEN`), call Groq **once** directly from a scratch script, with a generated one-second WAV of silence and then a tone, to prove the key and the request format work. **Never print the key.** If the file is absent, skip it and say so.

### 3. SQL `0007_voice.sql` / `04_voice.sql`
- Table `voice_usage(user_id, at, audio_ms)` with RLS (no client access), an index, and `dsa_voice_consume`.
- Re-runnable.
- Verified like S2 (libpg-query plus PGlite in the scratchpad) on top of `00` and `01`, with `94_voice_tests.sql` passing.

### 4. `VOICE.md` (for the owner, step by step)
1. **Keys:** create the **Groq** API key (console.groq.com → API Keys) and the **Hugging Face** token (Settings → Access Tokens, "Make calls to Inference Providers" permission). **Never paste them in chat or in git.**
2. **Supabase secrets:** Dashboard → Edge Functions → Secrets → add `GROQ_API_KEY` and `HF_TOKEN`.
3. **SQL:** paste `supabase/sql-editor/04_voice.sql` into the SQL Editor (and `94_voice_tests.sql` to check it).
4. **Deploy the function, either way (no Docker):**
   - (a) Dashboard → Edge Functions → Deploy a new function → editor, paste the files (say exactly which, since the dashboard editor may need them combined into one file; if so, generate `supabase/functions/transcribe/dashboard-single-file.ts` with `npm run voice:bundle-function`);
   - (b) CLI: `npx supabase login`, then `npx supabase functions deploy transcribe --project-ref <ref> --use-api`.
5. **Test with curl:** the anon-key sign-in flow to get a JWT, then the curl command with a recorded `.m4a`.
6. Costs and free-tier limits (as documented today, with links), and what the rate limit protects.
7. Troubleshooting.

## Verification (paste the output)
- `npm test --workspace packages/voice`, `typecheck`, and `npm test --workspace packages/core` (unchanged, green);
- the SQL checks;
- the smoke test result, or "skipped: no .env.local".

## Report
Write `docs/sessions/reports/S7a-voice.md` with:
- files and outputs;
- **what the owner must do and when** (keys, secrets, SQL, deploy, test);
- the confirmed Groq and HF request formats with doc links;
- the calibration defaults;
- notes for S7b (how to feed the expo-audio metering into `analyzeEnvelope`, and the exact client call).
