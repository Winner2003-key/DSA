# VOICE — setting up speech-to-text for DSA

This guide is for the project owner. It turns on the server side of voice play: the `transcribe` Edge Function, which sends a short recording to **Groq** (Whisper) and falls back to **Hugging Face** if Groq is down. No Docker is needed, and you don't have to install anything except (optionally) Node for the CLI route.

What you'll do, in order:

| Step | Where | Time |
|---|---|---|
| 1. Create the Groq key and the Hugging Face token | console.groq.com, huggingface.co | 5 min |
| 2. Store them as Supabase secrets | Supabase dashboard | 2 min |
| 3. Run the SQL (rate limit) | Supabase SQL Editor | 2 min |
| 4. Deploy the function | Supabase dashboard **or** CLI | 5 min |
| 5. Test it with curl | your terminal | 5 min |

Sections 6 and 7 cover costs and troubleshooting. A room played with **Voix** is a
different thing — a live call between the two phones, with nothing transcribed —
and has its own section at the end: **"Appel dans une salle"**.

> **Never paste a key or token into a chat (including Claude), a commit, an issue, or a Vercel variable.** They go in exactly two places: the Supabase secrets page (step 2), and, only if you want to run the local smoke test, the gitignored file `supabase/functions/.env.local`.

---

## 1. Create the keys

### Groq API key (main provider)

1. Go to <https://console.groq.com> and sign in (a Google or GitHub account works).
2. In the left menu, open **API Keys** → **Create API Key**.
3. Name it `dsa-transcribe` and click **Submit**.
4. Copy the key (it starts with `gsk_`). **Groq shows it only once.** Keep it in your password manager until step 2.

The free plan is enough to start (see section 6).

### Hugging Face token (fallback)

1. Go to <https://huggingface.co> and sign in or create a free account.
2. Click your avatar → **Settings** → **Access Tokens** → **Create new token**.
3. Choose **Fine-grained**, name it `dsa-transcribe`.
4. Under **Inference**, tick **Make calls to Inference Providers**. Nothing else is needed.
5. Click **Create token** and copy it (it starts with `hf_`).

Direct link with the right permission pre-selected: <https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained>

The fallback is optional: without `HF_TOKEN` the function uses Groq only.

---

## 2. Store the keys as Supabase secrets

1. Open your project in <https://supabase.com/dashboard>.
2. Left sidebar → **Edge Functions** → **Secrets** (in some dashboard versions: **Project Settings → Edge Functions**).
3. Add two secrets, then **Save**:

   | Name | Value |
   |---|---|
   | `GROQ_API_KEY` | the `gsk_…` key |
   | `HF_TOKEN` | the `hf_…` token |

The names must be exactly these (capitals, underscore). `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to every function automatically: **don't** add them.

You can add the secrets before or after deploying the function (step 4). If you change a secret later and the function still behaves as before, deploy it again.

---

## 3. Run the SQL (rate limit)

The function refuses to call Groq until this is installed.

1. Left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/sql-editor/04_voice.sql` in the repo, copy **all** of it, paste, click **Run**.
   Expect **"Success. No rows returned"**.
3. New query again: paste all of `supabase/sql-editor/94_voice_tests.sql`, click **Run**.
   Expect one row: **`ALL DSA VOICE TESTS PASSED`**. It changes nothing (it rolls back).

It needs `00_all_migrations.sql` to have been run before (it uses the same auth setup). Both files can be run again safely.

What it creates: a private table `voice_usage` (no app can read it) and the function `dsa_voice_consume`, which allows each signed-in user **40 transcriptions per 10 minutes** and **900 seconds of audio per 24 hours**. To change the limits, edit the constants at the top of `dsa_voice_consume` in `04_voice.sql` (and `migrations/0007_voice.sql`, keep them identical) and run the file again.

---

## 4. Deploy the function (no Docker)

Pick **one** of the two ways.

### (a) Dashboard editor — recommended, nothing to install

The dashboard editor starts with a single file, so the repo has a ready-made single-file version.

1. If you changed `supabase/functions/transcribe/core.ts` or `index.ts`, regenerate the single file first: from the repo root, `npm run voice:bundle-function`. (It's already generated and committed; `npm test --workspace packages/voice` fails if it's out of date.)
2. Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. Name the function exactly **`transcribe`**.
4. Delete the template code in the editor. Open `supabase/functions/transcribe/dashboard-single-file.ts` in the repo, copy **all** of it and paste it as the content of the editor's `index.ts`.
   Paste only this one file. Don't paste `core.ts` or `index.ts` separately.
5. Click **Deploy function** and wait for "Deployed".
6. In the function's page, check that **JWT verification is on** ("Verify JWT" / "Enforce JWT verification", on by default). **Keep it on.**

To update later: open the function → **Code**, replace everything with the new `dashboard-single-file.ts`, **Deploy** again.

### (b) CLI — deploys `core.ts` + `index.ts` as they are in the repo

Needs Node 20+ (already required for this repo). From the repo root:

```bash
npx supabase login                                   # opens the browser once
npx supabase functions deploy transcribe --project-ref <your-project-ref> --use-api
```

- `<your-project-ref>` is the part before `.supabase.co` in your project URL (`https://<ref>.supabase.co`), also shown in **Project Settings → General**.
- `--use-api` bundles on Supabase's servers, so **Docker is not used**.
- Don't add `--no-verify-jwt`: JWT verification must stay on.

`dashboard-single-file.ts` is ignored by this route (nothing imports it).

---

## 5. Test it with curl

You need the **Project URL** and the **anon (publishable) key** from **Project Settings → API** (the same values as `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`), and **anonymous sign-ins enabled** (DATABASE_SCHEMA.md, setup step 3).

### 5.1 Record a test file

Any short recording of you saying "oui" works:

- **Phone:** record a voice memo ("oui"), send it to your computer, rename it `oui.m4a`.
- **Linux:** `arecord -d 2 -f S16_LE -r 16000 oui.wav` (then use `oui.wav` and `type=audio/wav` below).
- **Mac:** QuickTime Player → File → New Audio Recording → export as `oui.m4a`.

### 5.2 Get a user token (anonymous sign-in)

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon or publishable key>"

export USER_JWT=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).access_token))')

echo "${USER_JWT:0:20}…"    # should start with eyJ
```

This creates one anonymous test user, exactly like the app does. The token is valid for about an hour.

### 5.3 Call the function

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/transcribe" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -F "audio=@oui.m4a;type=audio/m4a" \
  -F "hint=Homme ? Oui, non, je ne sais pas, question." \
  -F "duration_ms=1500"
```

Expected (the words and timings will differ):

```json
{"text":"Oui.","provider":"groq","durationMs":1480,"words":[{"word":"Oui","startMs":120,"endMs":560}]}
```

Also check the refusals:

```bash
# no user token → 401 {"error":"DSA_VOICE_UNAUTHORIZED",…}
curl -s -X POST "$SUPABASE_URL/functions/v1/transcribe" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -F "audio=@oui.m4a;type=audio/m4a"
# wrong type → 415 {"error":"DSA_VOICE_UNSUPPORTED_TYPE",…}
curl -s -X POST "$SUPABASE_URL/functions/v1/transcribe" -H "Authorization: Bearer $USER_JWT" -F "audio=@VOICE.md;type=text/markdown"
```

The function's **Logs** tab shows one JSON line per request (status, provider, sizes, timings). It never logs audio, hints, transcripts or keys.

### Optional: check the Groq key from your computer, without Supabase

Create `supabase/functions/.env.local` (gitignored by `.env.*`) with one line `GROQ_API_KEY=gsk_…`, then run `npm run smoke:groq --workspace packages/voice`. It sends a generated 1-second silence and a 1-second tone to Groq and prints the HTTP status and the response fields, never the key.

---

## 6. Costs, free tiers, and what the rate limit protects

Figures as documented on **2026-09-16**; check the links, they change.

| Service | Free | Paid |
|---|---|---|
| **Groq** `whisper-large-v3-turbo` ([rate limits](https://console.groq.com/docs/rate-limits), [speech-to-text](https://console.groq.com/docs/speech-to-text)) | 20 requests/min, **2,000 requests/day**, 7,200 audio seconds/hour, 28,800 audio seconds/day, files up to 25 MB | $0.04 per audio hour, **minimum 10 s billed per request** |
| **Hugging Face** Inference Providers ([pricing](https://huggingface.co/docs/inference-providers/pricing)) | $0.10 of credits/month (free account), $2.00 (PRO) | pay-as-you-go after buying credits; `hf-inference` is billed by compute time |
| **Supabase** Edge Functions ([pricing](https://supabase.com/docs/guides/functions/pricing)) | 500,000 invocations/month | Pro: 2 million included, then $2 per million |

What this means for DSA: each spoken answer is one request, so on Groq's free plan the whole app can transcribe about **2,000 answers a day**. That's plenty for testing and small groups. Past that, Groq returns 429 and the function falls back to Hugging Face, whose free credits are small; after that, players get "La reconnaissance vocale ne répond pas…" and keep playing with the buttons (the game never depends on voice).

**The rate limit (step 3)** stops one player, or one buggy app loop, from using up everyone's free quota: 40 requests per 10 minutes and 900 s of audio per day, **per signed-in user**. It does not stop someone who creates many anonymous accounts. For that, use Supabase's **Authentication → Rate Limits** (anonymous sign-ins per IP) and, if abuse ever happens, enable CAPTCHA under **Authentication → Attack Protection**. A global daily cap is planned for S8.

---

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401 {"code":401,"message":"Invalid JWT"}` or `Missing authorization header` (not a `DSA_VOICE_…` body) | Supabase's gateway refused the token before the function ran. Send the **user's access token** (step 5.2), not the anon key or a `sb_publishable_…` key; get a fresh token if it's more than an hour old. |
| `401 DSA_VOICE_UNAUTHORIZED` | The token is valid but isn't a user (for example the legacy anon key, which is also a JWT). Sign in first (anonymously is fine). |
| `503 DSA_VOICE_NOT_CONFIGURED` | Either `GROQ_API_KEY` and `HF_TOKEN` are both missing (step 2, check the exact names), or `04_voice.sql` hasn't been run (step 3). The **Logs** tab says which: `"step":"provider_keys"` or `"step":"rpc_missing"`. |
| `429 DSA_VOICE_RATE_LIMIT` | That user hit 40 requests / 10 min or 900 s / 24 h. The `Retry-After` header gives the seconds to wait. To reset a test user: SQL Editor → `delete from public.voice_usage;`. |
| `502 DSA_VOICE_PROVIDER_FAILED` | Groq and Hugging Face both failed. In **Logs**, `groqStatus` / `hfStatus`: `401` = wrong key (re-create it and update the secret), `429` = free quota used up, `400` = Groq couldn't read the audio (try `.m4a` or `.wav`), `null` with `groqFailure: "timeout"` = Groq took more than 8 s. Hugging Face `503` usually means the model is loading; try again a minute later. |
| `413 DSA_VOICE_TOO_LARGE` / `DSA_VOICE_TOO_LONG` | The recording is over 1.5 MB or 30 s. Answers are 1–2 s; check the app stops recording. |
| `415 DSA_VOICE_UNSUPPORTED_TYPE` | The audio part's type isn't one of `audio/m4a`, `audio/x-m4a`, `audio/mp4`, `audio/aac`, `audio/webm`, `audio/ogg`, `audio/wav`, `audio/mpeg`, or the body isn't `multipart/form-data`. With curl, add `;type=audio/m4a` after the file name. |
| `500 DSA_VOICE_INTERNAL` with `"step":"user_network"` or `"rpc"` | The function couldn't reach your project's Auth or database API. Retry; if it persists, check the project isn't paused (free projects pause after a week of inactivity: **Restore project**). |
| Browser: "CORS policy" error from the web app | Check the function is deployed and answers `OPTIONS` (curl `-X OPTIONS -i`). A 401 on `OPTIONS` means the gateway requires a JWT for preflight; tell the lead (the function already answers preflight itself). |
| The text is right but OUI vs OUIOUIOUI is wrong | Expected: Whisper writes a held "ouiiii" as "Oui". The app decides that from the sound, not the text (`packages/voice`, calibration in the app settings). |
| Whisper answers silence with "Sous-titrage Société Radio-Canada" or "Merci." | Expected, and handled: `isLikelyHallucination` (`packages/voice`) drops it, so the player gets "Je n'ai pas bien compris" instead of seeing the credits. If a new piece of boilerplate gets through, add it to that list. |
| A name is heard but the game doesn't take it | The matcher found two names too close to tell apart, or none above its threshold. Measure before changing anything: `npm run voice:eval`. |
| Transcript in the wrong language on the fallback | Hugging Face's endpoint has no language parameter, so very short clips can be detected as another language. Groq always gets `language=fr`. |
| CLI: `Cannot find project ref` | Add `--project-ref <ref>` (step 4b), or run `npx supabase link --project-ref <ref>` once. |
| CLI: asks for Docker | Add `--use-api`. Update the CLI with `npx supabase@latest …` if the flag is unknown. |

---

## 8. Measuring the recognition before changing it

`npm run voice:eval` runs the whole book's names through the intent matcher with
distortions a French recogniser really produces, and prints what it finds, gets
wrong, and can't resolve. It needs `data/book` on the machine; it calls no API and
costs nothing.

Use it before touching `phoneticKey` or `INTENT_THRESHOLDS` in `packages/core`.
The first change tried there — folding French nasal vowels the way the
carnetdevente matcher does — read well and measured **worse**: with 1,087 names,
collapsing "an/en/on" to one marker loses more than it joins, and the hit rate on
realistic mis-transcriptions fell from 18/24 to 13/24. It was dropped.

Real recordings beat invented distortions. Write a file of
`what was heard<TAB>what was meant`, one per line, and run:

```bash
npm run voice:eval -- --cases mes-enregistrements.tsv
```

Twenty or thirty lines from an actual player is enough to tell whether a change
helps, and it is the only way to know whether the problem is the matcher or the
recognition itself.

---

# Appel dans une salle (S7c)

A room played with **Voix** is a **live call** between the two phones: each player
hears the other's own voice, and nothing is transcribed
(`GAME_RULES.md` "Voix in a room is a call"). The Tireur ends the game with
**Trouvé** or **Pas trouvé**. The provider is **LiveKit Cloud** (free tier: 5 000
participant-minutes a month; each phone counts as one participant).

This is separate from everything above: speech recognition (`transcribe`) stays
the Voix mode of the other modes — against the application, and two players on one
phone. Nothing here changes it.

## The owner's steps, in order

| Step | Where | Time |
|---|---|---|
| 1. Create the LiveKit project and its key | cloud.livekit.io | 5 min |
| 2. Store the three values as Supabase secrets | Supabase dashboard | 2 min |
| 3. Deploy the `livekit-token` function | Supabase dashboard **or** CLI | 5 min |
| 4. Run `08_room_call.sql` | Supabase SQL Editor | 2 min |
| 5. Build and install the app (calls need a real build) | EAS | 20 min |

### 1. LiveKit keys

1. Go to <https://cloud.livekit.io> and sign in. Create a project (any region
   close to the players).
2. **Settings → Keys → Create key**. Copy the three values:
   `wss://<something>.livekit.cloud` (the project URL), the **API key**, and the
   **API secret**. The secret is shown once.

> The same rule as the Groq key: **never** paste these into a chat (including
> Claude), a commit, an issue, or a Vercel variable. They belong only in the
> Supabase secrets page.

### 2. Supabase secrets

Dashboard → **Edge Functions → Secrets** (or **Project Settings → Edge
Functions**) → add three secrets, with these exact names:

| Name | Value |
|---|---|
| `LIVEKIT_URL` | `wss://<something>.livekit.cloud` |
| `LIVEKIT_API_KEY` | the API key |
| `LIVEKIT_API_SECRET` | the API secret |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
by Supabase; you don't add them. If any of the three LiveKit secrets is missing,
the function answers `503 DSA_CALL_NOT_CONFIGURED` and the app says the call is
not configured yet — Boutons keeps working.

### 3. Deploy `livekit-token`

The same two routes as `transcribe`, with **Verify JWT on**.

**(a) Dashboard editor.** Edge Functions → **Deploy a new function** → **Via
Editor**, name it exactly **`livekit-token`**, delete the template, and paste all
of `supabase/functions/livekit-token/dashboard-single-file.ts`. Deploy, then check
that **Verify JWT** is on.

**(b) CLI**, from the repo root:

```bash
npx supabase functions deploy livekit-token --project-ref <your-project-ref> --use-api
```

If you changed `core.ts` or `index.ts`, regenerate the single file first with
`npm run voice:bundle-function` (it writes both functions' single files).

### 4. The SQL

SQL Editor → paste all of `supabase/sql-editor/08_room_call.sql` → **Run**.
Expected: "Success. No rows returned". Then run `90_tests.sql` and expect
`ALL DSA TESTS PASSED`. It is safe to run again.

This adds the call limits to **Réglages** in the admin app: the longest a call may
last (5 min), the minutes per player per day (40), the app's monthly budget
(4 500 = 90 % of the free 5 000), and the timezone whose midnight resets the day.
They are only checked when a call **starts** — creating or joining a Voix room, "Je
suis prêt", and "Nom suivant". **A game already being played is never cut** except
at its own call time.

### 5. A real build (the important part)

**Calls do not work in Expo Go**: LiveKit needs native WebRTC code. In Expo Go the
call screen says « L'appel nécessite l'application DSA installée. Sur ce téléphone,
tu peux jouer depuis le navigateur. », and Trouvé / Pas trouvé still work.

**Android** (no paid account needed):

```bash
cd apps/mobile
eas build -p android --profile development   # ~15 min, gives an APK link
# install the APK on both phones, then:
npx expo start --dev-client
```

**iPhone** needs a paid Apple Developer account:

```bash
cd apps/mobile
eas device:create                                   # register each iPhone once
eas build -p ios --profile development-device       # ios.simulator: false
```

**Or skip the build entirely:** open the web app in **Safari** (iPhone) or Chrome
(Android) — the browser has WebRTC built in, so a call between a phone browser and
an installed app works. The page must be served over **https** (Vercel is).

## Costs and what protects them

| | Free tier | What DSA does |
|---|---|---|
| LiveKit Cloud | 5 000 participant-minutes / month | A 2-minute game costs 4 minutes (two phones). The monthly budget setting refuses new calls at 4 500, leaving a margin. |
| Per player | — | 40 minutes a day by default, counted only for minutes actually played. |
| Per call | — | 5 minutes maximum, shortened if a player has less left today. |

Usage is recorded in `call_usage` when a game ends: one row per player per game,
readable only by that player. To reset a test day: SQL Editor →
`delete from public.call_usage;`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401 Invalid JWT` (not a `DSA_CALL_…` body) | Supabase's gateway refused the token first. The app sends the signed-in user's token; if you are testing with curl, use a user access token, not the anon key. |
| `503 DSA_CALL_NOT_CONFIGURED` | A LiveKit secret is missing or misspelled (step 2). The **Logs** tab says `"step":"livekit_env"`, or `"supabase_env"` if the service-role key is unavailable. |
| `403 DSA_CALL_NOT_STARTED` | The call has not opened yet: the Tireur has not pressed "Je suis prêt". Normal before the start. |
| `403 DSA_CALL_OVER` | The game is over, or the call time has passed. The app goes to the result screen by itself. |
| `403 DSA_CALL_WRONG_MODE` | That game is not a Voix room. Nothing to fix. |
| The app says « Voix » is unavailable before the game | A player has under a minute left today (`DSA_CALL_DAILY_LIMIT`) or the monthly budget is used up (`DSA_CALL_BUDGET_EXHAUSTED`). Raise the numbers in Réglages, or wait for the day to reset. |
| « L'appel nécessite l'application DSA installée » | Expo Go, or a browser without WebRTC. Use the development build, or the web app over https (step 5). |
| Connected, but neither player hears the other | Check both phones show « En ligne » and neither is « Micro coupé »; then check the microphone permission in the phone's settings. On the web, https is required. |
| Only one phone connects | Both must be in the **same game**: the room is `dsa-<session_id>`. Check the LiveKit dashboard's **Sessions** tab, which shows the room and its participants. |
