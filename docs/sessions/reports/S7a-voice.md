# Report S7a — voice foundations: `packages/voice` + the `transcribe` Edge Function

Status: **done**. `@dsa/voice` has 158 passing tests and a clean typecheck (the package, and the Edge Function code under `tsconfig.test.json`). `packages/core` is unchanged and green (170 tests). The SQL parses with the PostgreSQL 17 parser, runs twice on a Supabase-like PGlite on top of `00` and `01`, and `94_voice_tests.sql` passes. `deno check` passes for `index.ts` and the dashboard single file, and the function was served under real `Deno.serve` for a preflight and a 401. Nothing was committed.

**Not verified:**
- **The live Groq call:** skipped, because there is no `supabase/functions/.env.local`. A ready-made script is in place (§4).
- **Hugging Face:** its request format comes from the docs only.
- **The hosted dashboard:** no project was available. The owner's first run of `04 → 94` and the curl test in `VOICE.md` §5 are that check.

I didn't run `build.sh`, and didn't touch `00_all_migrations.sql`, `90_tests.sql`, `apps/mobile` or `packages/core`.

## 1. Result lines

```
$ npm test --workspace packages/voice
 ✓ test/purity.test.ts (4 tests)
 ✓ test/calibration.test.ts (8 tests)
 ✓ test/envelope.test.ts (26 tests)
 ✓ test/transcribe-client.test.ts (7 tests)
 ✓ test/speakable.test.ts (49 tests)
 ✓ test/answer-decision.test.ts (37 tests)
 ✓ test/transcribe-function.test.ts (27 tests)
 Test Files  7 passed (7)
      Tests  158 passed (158)

$ npm run typecheck --workspace packages/voice
> tsc --noEmit && tsc --noEmit -p tsconfig.test.json
(exit 0, no output)

$ npm test --workspace packages/core
 Test Files  11 passed (11)
      Tests  170 passed (170)
$ npm run typecheck --workspace packages/core
> tsc --noEmit            (exit 0)
```

### SQL checks

These ran in the session scratchpad with no Docker: `libpg-query` plus `@electric-sql/pglite` with `uuid_ossp`. The shim follows S2's: the roles `anon`, `authenticated` and `service_role`; `auth.users`; `auth.uid()` read from `request.jwt.claims`; Supabase's default grants on `public`; the `extensions` schema; and an empty `supabase_realtime` publication.

```
PARSE OK  migrations/0007_voice.sql  (10 statements)
PARSE OK  sql-editor/04_voice.sql  (10 statements)
PARSE OK  sql-editor/94_voice_tests.sql  (24 statements)
ERR  94_voice_tests.sql before 04 (expect the setup error): DSA VOICE TEST SETUP: run 04_voice.sql first
OK   00_all_migrations.sql
OK   01_seed_mini_graph.sql [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   04_voice.sql (run 1)
OK   04_voice.sql (run 2 — re-runnable)
OK   94_voice_tests.sql [{"result":"ALL DSA VOICE TESTS PASSED"}]
OK   94_voice_tests.sql (run 2, same database) [{"result":"ALL DSA VOICE TESTS PASSED"}]
voice_usage rows left after the tests: 0
OK   0007_voice.sql (the migration file, on top)
OK   90_tests.sql (existing suite, with 04 installed) [{"result":"ALL DSA TESTS PASSED"}]
```

**Mutation check.** Three copies of `04`, each broken on purpose, all make `94` fail:

```
--- MUTATION: requests ---   (limit 40 → 41)
ERR  94_voice_tests.sql: DSA VOICE TEST FAILED [3 accepted]: requests_left: expected '39', got '40'
--- MUTATION: rls ---        (table privileges not revoked)
ERR  94_voice_tests.sql: DSA VOICE TEST FAILED [1 privileges]: authenticated must not read voice_usage
--- MUTATION: anon ---       (EXECUTE granted to anon)
ERR  94_voice_tests.sql: DSA VOICE TEST FAILED [1 privileges]: anon must not execute dsa_voice_consume
```

`0007_voice.sql` and `04_voice.sql` have identical bodies (checked with `diff`); only the headers differ.

### Deno

Deno 2.9.6 was installed from npm into the scratchpad.

```
$ deno check index.ts dashboard-single-file.ts
Check index.ts
Check dashboard-single-file.ts                    (exit 0)

$ deno run --allow-net --allow-env dashboard-single-file.ts   (fake env, curl probes)
OPTIONS → HTTP/1.1 200 OK, Access-Control-Allow-Origin: *, Allow-Headers: authorization, x-client-info, apikey, content-type, …
POST without Authorization → {"error":"DSA_VOICE_UNAUTHORIZED","message_fr":"Connecte-toi pour utiliser la voix."}
logs: {"event":"transcribe","status":401,"ms":1,"step":"header"}      ← metadata only
```

### Smoke test

```
$ npm run smoke:groq --workspace packages/voice
skipped: no supabase/functions/.env.local
```

## 2. Files

```
packages/voice/                          @dsa/voice (new workspace; deps: @dsa/core; dev: typescript, vitest, @types/node)
  package.json                           scripts: test, typecheck, bundle-function, smoke:groq
  tsconfig.json                          src only: lib ES2022, types [] (no DOM, no Node)
  tsconfig.test.json                     tests + ../../supabase/functions/transcribe/core.ts (DOM + node types)
  src/envelope.ts                        analyzeEnvelope, rmsToDb, percentile, all constants
  src/calibration.ts                     calibrate, DEFAULT_CALIBRATION, soundLengthMs, median, parseCalibration
  src/answer-decision.ts                 decideAnswer, classifySound, readTranscript, CANONICAL_LABELS, BORDERLINE_RATIO
  src/lexicon.fr.ts                      LEXICON_FR: plain data {phrases, words}
  src/numbers.fr.ts                      cardinalFr, ordinalFr, readOrdinalToken ("TOME 1", "1ère", "2EME")
  src/speakable.ts                       speakablePrompt, speakableText, speakableName, speakableAnswer
  src/transcribe-client.ts               request/response types, limits, TranscribeError, buildTranscribeHint,
                                         parseTranscribeResult/Error, createTranscribeClient, transcribeUrl
  src/index.ts                           public exports
  scripts/bundle-function.mjs            core.ts + index.ts → dashboard-single-file.ts
  scripts/groq-smoke.mjs                 one Groq call each with 1 s of silence and a 1 s tone; never prints the key
  test/*.test.ts, test/helpers.ts        synthetic envelopes (50 ms frames, optional jitter)
supabase/functions/transcribe/
  core.ts                                all logic; fetch and env injected; no Deno globals, no imports
  index.ts                               Deno.serve wrapper (reads the 5 env vars, logs JSON metadata)
  dashboard-single-file.ts               GENERATED; the file to paste into the dashboard editor
supabase/migrations/0007_voice.sql       voice_usage + dsa_voice_consume
supabase/sql-editor/04_voice.sql         same body, owner header
supabase/sql-editor/94_voice_tests.sql   begin … rollback, 6 blocks, advisory-lock PASS line (key 20260916, 94)
VOICE.md                                 owner guide (keys, secrets, SQL, deploy a/b, curl, costs, troubleshooting)
package.json (root)                      + "voice:bundle-function"
package-lock.json (root)                 + the packages/voice workspace (from npm install --workspace packages/voice)
```

The purity test enforces the following:
- `src/` imports only `@dsa/core` and relative files;
- `src/` uses no `process`, `window`, `Blob`, `FormData`, `Deno`, React or `any`;
- `core.ts` has no imports and no `Deno`;
- `index.ts` imports only `./core.ts`;
- `dashboard-single-file.ts` is exactly what the bundler would generate now, so a stale bundle fails `npm test`.

## 3. What the owner must do, and when

Do this **after this report is reviewed**. Voice isn't needed before S7b (it's on the S7b brief's list of prerequisites). The step-by-step guide is `VOICE.md`.

| # | When | What | Expected |
|---|---|---|---|
| 1 | any time | Create the Groq API key (console.groq.com → API Keys) and the Hugging Face fine-grained token with "Make calls to Inference Providers". **Never paste them in chat or git.** | `gsk_…`, `hf_…` |
| 2 | after 1 | Dashboard → Edge Functions → Secrets: `GROQ_API_KEY`, `HF_TOKEN` | saved |
| 3 | after `00` (and `03` if needed) | SQL Editor: paste **`supabase/sql-editor/04_voice.sql`** → Run, then **`94_voice_tests.sql`** → Run | "Success. No rows returned", then `ALL DSA VOICE TESTS PASSED` |
| 4 | after 2–3 | Deploy `transcribe`: (a) dashboard → Deploy a new function → Via Editor → name `transcribe` → paste **all of `supabase/functions/transcribe/dashboard-single-file.ts`** → Deploy, JWT verification on; or (b) `npx supabase login` then `npx supabase functions deploy transcribe --project-ref <ref> --use-api` | "Deployed" |
| 5 | after 4 | `VOICE.md` §5: anonymous sign-in with curl, then POST a recorded `oui.m4a` | `{"text":"Oui.","provider":"groq",…}`; the 401 and 415 checks |
| 6 | optional | Create `supabase/functions/.env.local` with `GROQ_API_KEY=…`, then run `npm run smoke:groq --workspace packages/voice` | HTTP 200 twice |

**New SQL file for the lead's run-order list:** `04_voice.sql` (with its test file `94_voice_tests.sql`). `supabase/sql-editor/README.md` and `DATABASE_SCHEMA.md` are not mine to edit. They should gain rows for `04`/`94`, `voice_usage` and `dsa_voice_consume` (error codes `DSA_NOT_AUTHENTICATED`, `DSA_VOICE_INVALID_AUDIO`, `DSA_VOICE_RATE_LIMIT`), and S6's regenerated `00` should include `0007`.

## 4. Confirmed provider request formats

These were checked against the docs on 2026-09-16.

### Groq (main provider)

Docs: <https://console.groq.com/docs/speech-to-text>, <https://console.groq.com/docs/api-reference> (Create transcription), <https://console.groq.com/docs/rate-limits>.

```
POST https://api.groq.com/openai/v1/audio/transcriptions
Authorization: Bearer $GROQ_API_KEY
multipart/form-data:
  file                       audio.<ext>   (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm)
  model                      whisper-large-v3-turbo
  language                   fr
  response_format            verbose_json
  timestamp_granularities[]  word          ("response_format must be set verbose_json"; word timestamps add latency)
  temperature                0
  prompt                     <hint>        ("limited to 224 tokens")
→ 200 verbose_json: { text, duration (s), words: [{word, start, end}] (s), segments, … }
→ 429 with a retry-after header when rate limited
```

Timeout: 8 s (`GROQ_TIMEOUT_MS`).

### Hugging Face Inference Providers (fallback)

Docs: <https://huggingface.co/docs/inference-providers/tasks/automatic-speech-recognition>, <https://huggingface.co/docs/inference-providers/providers/hf-inference> (lists `openai/whisper-large-v3` under ASR), and the huggingface.js `hf-inference` provider source (route `${HF_ROUTER_URL}/hf-inference/models/${model}`, raw data body).

```
POST https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3
Authorization: Bearer $HF_TOKEN          (token with "Inference Providers" permission)
Content-Type: <the audio type>
body: raw audio bytes                    ("If no parameters are provided, you can also provide the audio data as a raw bytes payload")
→ 200 { text, chunks? }
```

The fallback is used when Groq times out, has a network error, returns 429 or 5xx, returns a malformed body, **or returns 401/403** (see deviation 3). Its timeout is 20 s. The documented parameters have **no language option**, so Hugging Face auto-detects the language.

## 5. Calibration and detector defaults

| Constant | Value | Where |
|---|---|---|
| `NOISE_FLOOR_PERCENTILE` | 10 | the noise floor is the 10th percentile of levels |
| `MIN_NOISE_FLOOR_DB` | −70 dBFS | the floor is never lower (digital silence is −160) |
| `VOICE_MARGIN_DB` | 12 dB | voiced from floor + 12 |
| `HYSTERESIS_DB` | 5 dB | stays voiced down to floor + 7 |
| `MIN_BURST_MS` | 60 | shorter runs are dropped (after merging) |
| `MERGE_GAP_MS` | 80 | shorter dips are merged into one sound |
| `MAX_BURST_GAP_MS` | 700 | bursts up to 700 ms apart belong to one utterance; the utterance with the most voiced time is kept |
| `DEFAULT_FRAME_MS` / `MAX_FRAME_MS` | 50 / 250 | frame length of the last sample; a gap in the metering ends the sound |
| `DEFAULT_CALIBRATION` | short 300 ms, long 1000 ms, **threshold 650 ms**, `good` | used when a person hasn't calibrated |
| `CALIBRATION_THRESHOLD_FLOOR_MS` | 550 | threshold = max(550, (short median + long median) / 2) |
| `CALIBRATION_MIN_SEPARATION_MS` | 250 | medians closer than this → `weak` (also `weak` if a whole set had no voice) |
| `BORDERLINE_RATIO` | 0.15 | 552.5–747.5 ms with the default threshold → `CONFIRM` |

**How `decideAnswer` decides:**
1. It returns UNKNOWN for anyone but the TIREUR.
2. It reads the transcript: "question" ×N gives REWIND. Otherwise it looks for the word: oui/ouais, non/nan, stretched spellings ("ouiii", "nooon", "nonnn") and glued ones ("ouioui"), then `matchIntent` from `@dsa/core`, then a lenient pass that accepts one answer word among up to 3 other words.
3. JE NE SAIS PAS → ANSWER if the prompt allows it, else UNKNOWN.
4. If the prompt allows neither the simple nor the repeated class of the word → UNKNOWN. If it allows only one of them → that one, whatever the sound. So OUI/NON-only prompts never return a repeated class.
5. If both are allowed, the sound decides:
   - no envelope or no voice → CONFIRM;
   - longest burst above threshold × 1.15 → repeated;
   - 2 or more bursts, with the transcript repeating the word → repeated;
   - 2 or more bursts, with a single word and no other words → CONFIRM;
   - longest burst within ±15 % → CONFIRM;
   - otherwise simple, **unless** the transcript hints at repetition ("ouiii", "oui oui"), which turns it into CONFIRM.

   Transcript hints never produce a repeated answer on their own.
6. Every result carries `evidence` (reason, verdict, soundMs, voicedMs, bursts, thresholdMs, transcript hints), for debugging and telemetry.

## 6. Notes for S7b

### Metering on native (expo-audio, works in Expo Go)

```ts
const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
const state = useAudioRecorderState(recorder, 50);   // the default polling interval is 500 ms: pass 50
const samples = useRef<EnvelopeSample[]>([]);
useEffect(() => {
  if (state.isRecording && typeof state.metering === 'number') {
    samples.current.push({ tMs: state.durationMillis, db: state.metering });
  }
}, [state.durationMillis, state.metering, state.isRecording]);
// on stop:
const envelope = analyzeEnvelope(samples.current);
```

- Before recording: `requestRecordingPermissionsAsync()`, `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })`, and **stop TTS** (S3 note).
- The `HIGH_QUALITY` preset writes `.m4a` (Android `mpeg4`/`aac`, iOS `MPEG4AAC`), so send it as `audio/m4a`.
- Start the recorder a little before the prompt ends, and keep ~300 ms of tail after release. `analyzeEnvelope` needs some quiet frames to find the noise floor: a recording that is all voice gives `voicedMs: 0`, and the decision is then CONFIRM, never a guess.
- `tMs` must come from the recording clock (`durationMillis`), not `Date.now()`, so pauses in the JS thread don't stretch the sound. Duplicate `durationMillis` values are harmless.

### Metering on the web

The expo-audio docs don't confirm web metering. Use Web Audio on the same `getUserMedia` stream:

```ts
const ctx = new AudioContext(); const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
ctx.createMediaStreamSource(stream).connect(analyser);
const buf = new Float32Array(analyser.fftSize); const t0 = performance.now();
const timer = setInterval(() => {
  analyser.getFloatTimeDomainData(buf);
  const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
  samples.push({ tMs: performance.now() - t0, db: rmsToDb(rms) });
}, 50);
```

On the web, record with `MediaRecorder` (Chrome gives `audio/webm;codecs=opus`, Safari gives `audio/mp4`). Both are accepted, and parameters after `;` are ignored.

### Calling the function

```ts
import { createTranscribeClient, buildTranscribeHint, decideAnswer, calibrate, parseCalibration, DEFAULT_CALIBRATION } from '@dsa/voice';

const stt = createTranscribeClient<{ uri: string } | Blob>({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  fetch: (url, init) => fetch(url, init as RequestInit),
  createFormData: () => new FormData(),
  appendAudio: (form, field, audio) =>
    audio instanceof Blob
      ? form.append(field, audio, 'answer.webm')                                   // web
      : form.append(field, { uri: audio.uri, name: 'answer.m4a', type: 'audio/m4a' }), // native (RN FormData)
});

const hint = buildTranscribeHint(state.prompt?.text ?? null, names, { context: state.path.map((p) => p.text) });
const { text } = await stt.transcribe({ uri: recorder.uri! }, { hint, durationMs: state.durationMillis });

const decision = decideAnswer({
  allowedClasses: state.prompt!.answer_classes,
  transcript: text,
  envelope,
  calibration: parseCalibration(JSON.parse(stored ?? 'null')) ?? DEFAULT_CALIBRATION,
  role: 'TIREUR',
});
// ANSWER  → game.answer(decision.label)          (already a canonical book label)
// CONFIRM → two big buttons decision.options[0] / [1]
// REWIND  → game.rewind(decision.count)
// UNKNOWN → "Je n'ai pas bien compris. Peux-tu répéter ?" + keep the buttons
```

- **HTTP call:** `POST {SUPABASE_URL}/functions/v1/transcribe`, `Authorization: Bearer <user access token>`, `apikey: <anon key>`, a multipart body with `audio`, `hint` and `duration_ms`. **Don't set `Content-Type`** yourself; the boundary must come from the platform.
- **Errors:** `TranscribeError` has `code`, `status`, `messageFr` (show it as is) and `retryAfterS`. A network failure is `DSA_VOICE_NETWORK` (status 0).
- **Calibration screen:** record 2–3 × "Dis OUI" and 2–3 × "Dis OUI très long". Pass `calibrate(shortAnalyses, longAnalyses)` to `JSON.stringify`, then store it locally. If `quality === 'weak'`, suggest redoing it.
- **TTS:** use `speakablePrompt(prompt.text)` for questions, `speakableAnswer(label)` for answers, and `speakableName(name)` for name calls. The screen keeps the book spelling. S3's current utterance, "Est-ce LIE A ABRAHAM ?", should become `speakablePrompt('LIE A ABRAHAM')`, which gives "Lié à Abraham ?".
- **Découvreur speech:** name calls and ASK still go through `matchIntent` with the transcript. `decideAnswer` is for the Tireur only.
- **`buildTranscribeHint`:** it promotes names that appear in the prompt or the context. Pass `knownNames` with the likeliest first.

## 7. Deviations and interpretations

1. **User resolution without supabase-js.** `core.ts` calls `GET {SUPABASE_URL}/auth/v1/user` and `POST /rest/v1/rpc/dsa_voice_consume` with `fetch`, the `apikey` header and the request's `Authorization`. That is what `createClient(url, anonKey, { global: { headers: { Authorization } } })` does. It keeps `core.ts` import-free, so vitest can test it with a mocked fetch and the dashboard needs only one file. `verify_jwt` stays on. The user check is still needed because the legacy anon key is itself a valid JWT.
2. **"Voiced length" is the longest burst** (`soundLengthMs = longestBurstMs`), both in calibration and in the decision. `voicedMs` (the sum over the utterance) is also returned. With the sum, "euh… oui" would count as one long sound. A held sound split by a dip over 80 ms still ends up repeated or CONFIRM through the burst rule.
3. **Groq 401/403 also falls back** to Hugging Face, besides timeout, 429 and 5xx, so one wrong secret doesn't turn voice off. A Groq 400 (unreadable audio) returns 502 without falling back.
4. **Extra status codes** besides the brief's 401/413/415/429/502:
   - 400 `DSA_VOICE_BAD_REQUEST` (no audio part / unreadable form);
   - 405;
   - 413 `DSA_VOICE_TOO_LONG` (declared `duration_ms` over 30 s, or a WAV header over 30.5 s);
   - 415 also for a non-multipart body;
   - 503 `DSA_VOICE_NOT_CONFIGURED` (no provider key, or `04_voice.sql` not run);
   - 500 `DSA_VOICE_INTERNAL`.

   The client adds `DSA_VOICE_NETWORK`.
5. **Audio length for the rate limit.** The server can't decode m4a or webm, so it charges max(declared `duration_ms`, size estimated at 64 kbit/s), capped at 30 s. WAV is read from its header. A client can't under-report by much, and an honest 1.5 s m4a at 128 kbit/s (24 kB) is charged about 3 s.
6. **"Per day" is a rolling 24 hours**, and "per 10 minutes" is rolling too. A refused call records nothing. A call that passes the limit is recorded even if the providers then fail, so a failing provider can't be hammered.
7. **`durationMs` in the response** is the audio length: Groq's `duration`, or the server's estimate. §1 of the spec says `duration_ms`; I used the brief's `durationMs`, which is also what S3's `stt.ts` placeholder uses. **Please update §1.**
8. **The spec §1 `AnswerAudioClassifier` "in `apps/mobile/src/speech/`"** now lives in `packages/voice`: `analyzeEnvelope`, `calibrate` and `decideAnswer`. S7b only wires it up.
9. **Hint size.** `buildTranscribeHint` aims at 400 characters (≤ 40 names), because Whisper's prompt is limited to 224 tokens and capitalised Bible names tokenize poorly. The server still cuts at 800 characters.
10. **Lexicon rules beyond the listed entries:**
    - An unlisted word in capitals is read as a name (`DAVID` → David); other words are kept as written.
    - Parentheses are dropped (`PENTATEUQUE (HOMMES)` → "Pentateuque hommes ?").
    - A leading "Est-ce (que) (c'est) (dans) (le/la/les/un/une)" is removed.
    - `speakableText` and `speakableName` are exported too.
    - A local, unsaved scan of the book's 955 distinct labels found the common words the lexicon was missing, and they were added. What's left unlisted is names, which are read as names.
11. **Added scripts:** root `voice:bundle-function` (requested) and `packages/voice` `smoke:groq`.

## 8. Open questions

1. **Abuse across accounts.** The limit is per user, and anonymous sign-ins make new users cheap. The whole app shares Groq's free **2,000 requests/day**. Should S8 add a global daily cap (for example a `voice_usage` total per day in `dsa_voice_consume`) and a CAPTCHA on anonymous sign-in?
2. **Hugging Face language.** The raw-bytes call can't force French, so a 0.3 s "oui" may come back in another language on the fallback. Options: accept it (Groq is primary), switch the fallback to an HF provider that takes `language` (unverified), or drop the fallback.
3. **`audio/aac`** is accepted as the brief asks, but Groq's documented formats don't include raw AAC (ADTS). expo-audio's presets produce `.m4a` (MP4 container), which is supported. Should `audio/aac` be removed? It is kept for now, and a Groq 400 would show as a 502.
4. **`p_spoken_label` (S3 report §5.6).** `decideAnswer` returns the canonical label, and the transcript is available if the record should keep what was said. That needs an SQL change owned by someone else.
5. **Hosted details to confirm on the owner's first deploy:**
   - that the gateway lets `OPTIONS` preflight through while `verify_jwt` is on. The function answers it; `VOICE.md` troubleshooting covers the case where the gateway doesn't;
   - the exact label of the dashboard's JWT-verification toggle.
