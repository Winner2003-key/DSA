# Report S3: `apps/mobile`, the Expo game app

Status: **done**. The typecheck is clean, all 35 tests pass, expo-doctor passes 21/21 checks with no warnings, and the web export succeeds. Three full offline games were played in a headless browser, with 19 screenshots saved. Nothing was committed.

**Not verified:** Expo Go on a real phone (no device was available to this session) and the hosted Supabase project (no credentials). Those two checks are the owner's first run; the commands are in §4.

## 1. Result lines

```
$ npm run typecheck --workspace apps/mobile
> @dsa/mobile@0.1.0 typecheck
> tsc --noEmit
exit 0

$ npm test --workspace apps/mobile
PASS tests/supabase-errors.test.ts
  SupabaseGameService error mapping
    ✓ maps DSA_<CODE> to its French message   (21 tests, one per server code:
      NOT_AUTHENTICATED NOT_PLAYER WRONG_ROLE WRONG_MODE GAME_OVER NOT_AWAITING_QUESTION
      NOT_AWAITING_ANSWER NOT_AWAITING_GUESS_CONFIRM NO_PROMPT ANSWER_NOT_ALLOWED INVALID_NAME
      INVALID_STEP INVALID_REWIND INVALID_MODE INVALID_ROLE GRAPH_NOT_FOUND GRAPH_INVALID
      NO_PLAYABLE_SECRET ROOM_CODE_EXHAUSTED ROOM_NOT_FOUND ROOM_FULL)
    ✓ never leaks the raw server text into the message
    ✓ maps an unknown DSA code, a permission error and a network failure
    ✓ maps a thrown transport error too
    ✓ reports a failed anonymous sign-in in French
  SupabaseGameService call shapes
    ✓ unwraps the one-row array of dsa_create_session
    ✓ sends the canonical answer label as given, never raw speech
    ✓ normalises a state that omits the optional fields
PASS tests/offline-game.test.tsx
  scenario 1 — secret CAÏN, normal play (AI Tireur)
    ✓ walks the book to the leaf and ends DISCOVERED
    ✓ refuses a wrong name and leaves the position untouched
  scenario 7 — the Tireur says "QUESTION" once (LOCAL)
    ✓ undoes the wrong NON and keeps it out of the revealed path
    ✓ records the book’s canonical label, not the spoken one
PASS tests/decouvreur-never-sees-the-secret.test.tsx
  the Découvreur view
    ✓ renders the prompt and the path but never the secret
    ✓ keeps the card out of the tree even after the Découvreur acts
  the Tireur view (the control)
    ✓ does show the card, so the test above is not vacuous

Test Suites: 3 passed, 3 total
Tests:       35 passed, 35 total

$ npx expo-doctor
Running 21 checks on your project...
21/21 checks passed. No issues detected!

$ npx expo export -p web
Web Bundled (1408 modules)
› Assets (22)          # 4 Zilla Slab weights + expo-router/react-navigation icons
› web bundles (1):
_expo/static/js/web/entry-….js (2.6MB)
› Files (3): favicon.ico (15KB) · index.html (1.3KB) · metadata.json (49B)
Exported: dist          # 3.7 MB in total
```

What the tests prove:
- **Scenarios 1 and 7** run through the real `useGame` hook, the real `OfflineGameService` and the `@dsa/core` engine, with nothing stubbed. Scenario 1 uses AI_TIREUR mode: 7 asks, then the call "caïn", then DISCOVERED, with the revealed path and the description checked. Scenario 7 uses LOCAL mode: a wrong NON, then `rewind(1)`, then the prompt is LIE A ADAM again, and the undone NON is absent from the revealed path.
- **Secret test:**
  - The state is deliberately leaky: the card appears both on the TIREUR player row and at the top level. The rendered Découvreur tree contains neither the name, the description nor the node id, and `getMySecret` is never called.
  - A control test renders the Tireur view with the same fake service and does find the name, so the negative test can't pass by accident.

## 2. Screenshots (`docs/sessions/reports/S3-screens/`)

These come from the web build with `EXPO_PUBLIC_DSA_OFFLINE=1`, driven by Playwright with the system Chrome at 390×844 @2x unless noted. The whole run produced **no page errors and no console errors**.

| # | Flow |
|---|---|
| 01–08 | **AI_TIREUR, full game (dark):** Accueil → Jouer → first question → answer plus path → leaf reached → name autocomplete ("dav" → DAVID) → wrong name refused → the secret typed without accents → 🎉 result with the animated path |
| 09–13 | **LOCAL:** "Passe le téléphone" → Tireur with the card hidden → card shown, PENTATEUQUE offers OUI / NON / **NON NON NON** → "QUESTION ×1" brings PENTATEUQUE back → Découvreur "Revenir à une question" → HOMME again |
| 14–16 | **AI_DECOUVREUR, full game (light theme):** "L’application réfléchit…" → the AI asks → result after 9 turns |
| 17 / 18 | 400 px and 1280 px widths, both with **no horizontal overflow**. On desktop the content stays in a 520 px reading column. |
| 19 | A build with no Supabase variables and no offline flag shows "L’application n’est pas configurée : il manque l’adresse du serveur." |

## 3. Files

```
apps/mobile/
  package.json            @dsa/mobile; scripts: start, web, export:web, typecheck, test, doctor
  app.json                name DSA, slug/scheme dsa, com.pahilabs.dsa (android + ios), locales.fr, web.output "single"
  eas.json                development (dev client, internal), preview (android APK, internal), production (aab)
  vercel.json             build/output/install, SPA rewrite to /index.html, cache headers
  metro.config.js         default Expo config (workspace detection verified by the export)
  babel.config.js, tsconfig.json (strict, noUncheckedIndexedAccess, @/* → src/*)
  jest.config.js, jest.setup.ts
  .env.example, .gitignore (.env ignored), README.md (run, check, "Deploy web on Vercel", EAS)
  locales/fr.json         iOS display name
  assets/                 icon, adaptive icon (+ monochrome), splash, favicon: generated "DSA" brass mark
  app/_layout.tsx         fonts, splash, gesture/safe-area/theme/speech providers, Stack
  app/index.tsx           Accueil: DSA, Découverte Sans Alphabet, Jouer, Jouer avec un ami (Bientôt), Explorer (Bientôt), theme
  app/jouer/index.tsx     Je suis le Découvreur (AI_TIREUR) · Je suis le Tireur (AI_DECOUVREUR) · Deux joueurs sur ce téléphone (LOCAL)
  app/partie/[sessionId].tsx    picks TireurView or DecouvreurView from my roles / awaiting; pass-phone in LOCAL; quit
  app/resultat/[sessionId].tsx  🎉 name + description, "Voici le chemin…", stats, animated path, Rejouer / Accueil
  src/services/game-service.ts          interface GameService (brief's methods + offline, supportsRealtime, optional subscribe)
  src/services/types.ts                 GameState / PathEntry / RevealedPath / Secret … and CANONICAL_LABEL
  src/services/errors.ts                DsaError + toDsaError (DSA_<CODE> → French)
  src/services/supabase.ts              createClient with AsyncStorage session, ensureSignedIn (signInAnonymously)
  src/services/supabase-game-service.ts every RPC, typed; injectable RpcClient for tests
  src/services/offline-game-service.ts  @dsa/core GameEngine + mini-graph.json, same JSON/roles/errors as the RPCs
  src/services/index.ts                 getGameService() (offline only when EXPO_PUBLIC_DSA_OFFLINE=1), GRAPH_SLUG
  src/state/use-game.ts                 useGame(sessionId): fetch, polling, subscribe hook point, AI Découvreur turns, refusedGuess
  src/state/use-secret.ts, use-names.ts (cache + accent-insensitive search), game-stats.ts ("retours" counter)
  src/speech/tts.ts                     TextToSpeech: expo-speech (native) / speechSynthesis (web), fr-FR
  src/speech/use-speech.tsx             SpeechProvider: persisted mute toggle, speak()
  src/speech/stt.ts                     SpeechToText + AnswerAudioVerdict interfaces, unavailable placeholder (S7)
  src/lib/haptics.ts                    native-only haptic feedback
  src/views/decouvreur-view.tsx, tireur-view.tsx
  src/components/                       answer-slab, answer-echo, prompt-card, path-trail, secret-card, name-pad,
                                        step-picker, sheet, pass-phone, revealed-path, buttons, chrome, screen,
                                        app-text, repeat-mark, fit-variant
  src/i18n/fr.ts                        every UI string, spoken strings, one French line per error code
  src/theme/                            colors (dark + light), typography, spacing, ThemeProvider
  tests/                                3 test files + helpers
package-lock.json (root)                apps/mobile added via npm install / npx expo install
docs/sessions/reports/S3-expo.md, S3-screens/*.png
```

Dependencies added (all from `npx expo install`, SDK 57): `expo-speech`, `expo-haptics`, `expo-linear-gradient` (installed but unused so far; see §5.9), `expo-font`, `@react-native-async-storage/async-storage` 2.2.0, `@supabase/supabase-js` 2.116, `@expo-google-fonts/zilla-slab`. Dev: `jest-expo`, `jest`, `@testing-library/react-native` 14, `@types/jest`.

## 4. Commands for the owner

```bash
# once, from the repo root
npm install
cp apps/mobile/.env.example apps/mobile/.env      # fill EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY

# phone (Expo Go, same Wi-Fi; add --tunnel otherwise)
cd apps/mobile && npx expo start                   # scan the QR code with Expo Go

# demo without a server
cd apps/mobile && EXPO_PUBLIC_DSA_OFFLINE=1 npx expo start --clear

# web
cd apps/mobile && npx expo start --web             # dev
cd apps/mobile && npx expo export -p web --clear   # static build in dist/ (Vercel: see README "Deploy web on Vercel")

# Android APK
npm install -g eas-cli
cd apps/mobile && eas login && eas init
eas build -p android --profile preview
```

Before the first real game: run `00 → 01 → 90` in the SQL Editor, **enable anonymous sign-ins**, and make sure the graph named in `EXPO_PUBLIC_DSA_GRAPH_SLUG` is PUBLISHED and active. Use `mini` until the book is imported and approved; otherwise you'll get `DSA_GRAPH_NOT_FOUND` or `DSA_NO_PLAYABLE_SECRET`, shown in French.

## 5. Deviations, findings and open questions

1. **Metro caches `EXPO_PUBLIC_*` values.** A normal export that ran right after an offline export shipped **offline mode**. `--clear` fixed it, and it is now in the `export:web` script, `vercel.json` and the README. Vercel builds from a clean cache, so this mainly affects local builds, but it is exactly how a demo build could reach production.
2. **The web output is `"single"` (an SPA), not `"static"`.** `/partie/[id]` and `/resultat/[id]` are runtime ids that can't be pre-rendered, and the brief asks for SPA rewrites.
3. **"Retours" is counted by the client.** `dsa_get_revealed_path` returns no counts, and clients can't read `game_moves`. The app counts its own `goBack` and `rewind` calls. After a reload that statistic is left out rather than shown wrong, and in HUMAN_VS_HUMAN it will only count this device's moves. **Proposal (lead/S2):** add `stats: {questions, non, backs, rewinds}` to `dsa_get_revealed_path`.
4. **A refused name call is detected in `useGame`, not in the view** (this bug was found in the browser run). AI_TIREUR refuses in the same round trip, so `pending_guess` is never seen, and in LOCAL the Découvreur view is unmounted while the Tireur answers. The hook exposes `refusedGuess` and has a test.
5. **Rewind availability.** DATABASE_SCHEMA's table lists `NOT_AWAITING_ANSWER` for `dsa_rewind`, while §7 and the S2 report allow rewind while awaiting QUESTION *or* ANSWER. The Tireur's ×1/×2/×3 buttons are enabled in both states (capped at the path length); if the server refuses, the player sees the French error. **Please confirm the intended rule.**
6. **`dsa_answer` has no spoken-label parameter.** Clients must send the canonical label (§7), so `payload.spoken_label` will always equal the canonical label. S7 needs a `p_spoken_label` parameter if the spoken form should be recorded.
7. **Zoom on the revealed path.** A−/A+ controls work everywhere, and pinch works on native only, stepping through the same 4 zoom levels. It isn't a continuous zoom or pan: large steps suit phone players better. Pinch hasn't been tried on a device.
8. **Offline service details:**
   - It mirrors the RPC contract: roles, awaiting checks, `DSA_` codes, canonical book labels, and immediate answers in AI_TIREUR.
   - `joinSession` isn't supported offline (`ROOM_NOT_FOUND`).
   - The last 5 games are kept in AsyncStorage, so a web reload doesn't lose the demo.
   - `secretNodeKey` is a test seam that picks the card.
9. **Unused dependency:** `expo-linear-gradient` is installed but unused; the design doesn't need gradients. Remove it or keep it for S6.
10. **The mini-graph fixture is always bundled** (~35 KB), even when offline mode is off, because `offline-game-service.ts` imports it statically. It's harmless, but it's the test graph's structure. Making the import lazy would keep it out of production bundles; this is a small follow-up if the lead wants it.
11. **Suggestions for `packages/core`** (not edited):
    - The app imports `@dsa/core/fixtures/mini-graph.json`. That only works while core's `package.json` has no `exports` field. If one is added, it must include `./fixtures/*`.
    - The core root index also pulls `uuid` into the app bundle, which the app doesn't use. A `@dsa/core/rules` entry (rules + engine + types) would avoid that. Jest needs `uuid` in `transformIgnorePatterns` (done).
    - S4 edited `packages/core` while this session ran. The tests passed against its current state.
12. **Speech.** The Découvreur hears the answer and the next question as one utterance ("Non. Est-ce LIE A ABRAHAM ?"); the Tireur hears the question or the name being called. Identical back-to-back utterances aren't repeated (for example, two refused calls at the same prompt). Web TTS and haptics can't be checked headless.
13. **Loop guard.** The AI Découvreur stops after 24 automatic steps in a row without a human move (S2 open question 2: it can cycle against a mistaken Tireur). The Tireur can still use "QUESTION" to get it moving again.
14. **`npm audit`** reports 16 moderate issues in the workspace tree (mostly Expo and Jest tooling). They weren't investigated, and no `audit fix --force` was run.
15. **Design** (the frontend-design skill was used):
    - **Palette:** a "chalkboard and brass lamp" theme: board green-black `#0E1A17`, chalk `#F3EEE2`, brass `#E9A825`. The light theme uses exercise-book green-grey paper.
    - **Type:** one slab family, Zilla Slab, loading only 4 weights. The package barrel would have pulled in 2.4 MB of fonts.
    - **Answer buttons:** answers are encoded twice, warm/light for OUI and cool/dark for NON, so they're readable without colour vision. Repeated codes also carry a stacked-bar mark. The answer buttons are 68 pt slabs with a solid underside that collapses on press, plus haptics.
    - **Motion:** the only choreographed motion is the result-path reveal, and it respects reduced motion.
    - **Text sizing:** large text is sized by its longest word, so a book label like PENTATEUQUE never breaks mid-word (a bug found in the screenshots).

## 6. For S6 (rooms and realtime)

- **Service:** `GameService` already has `createSession({mode, role})` and `joinSession(code)`. To add realtime:
  - implement `subscribe(sessionId, onChange)` in `SupabaseGameService` with `postgres_changes` on `game_sessions` (`id=eq.`), `game_moves` and `game_players` (`game_session_id=eq.`);
  - call `onChange()` with no payload, and return the unsubscribe function;
  - set `supportsRealtime = true`.

  `useGame` already calls `subscribe` and refetches through `getState`. It also stops polling, which currently runs every 2 s **only** for `HUMAN_VS_HUMAN` while PLAYING.
- **Roles:** `myRoles` comes from `players[].is_me`, and `activeRole` from `awaiting`. `partie/[sessionId]` shows the view for `myRoles[0]`, or `activeRole` in LOCAL, so a HvH device shows its own role with no change needed. Show "waiting for the other player" while `status = WAITING`; right now the screen only redirects when status isn't PLAYING, so **handle WAITING before that redirect**.
- **Name calls:** `refusedGuess` also works when the refusal arrives by refresh (it watches `pending_guess` go from set to null).
- **Accueil:** enable "Jouer avec un ami" (`testID home-friend`) and add the room-code screens; the strings go in `src/i18n/fr.ts`.
- **Result screen:** `RevealedPathView` is where more reveal animation would go.

## 7. For S7 (voice)

- **Interfaces:** `src/speech/stt.ts` defines `SpeechToText { available, start(), stop(hint) → {text, provider, durationMs}, cancel() }` and `AnswerAudioVerdict { repeated: boolean|null, voicedMs, bursts }`. Its `null` means borderline, which should show the two-button choice (§1). The placeholder reports `available = false`, and nothing in the UI depends on it.
- **Answers:** the answer buttons are the complete input path. Voice must end in the same call, `game.answer(CANONICAL_LABEL[cls])`, with `cls` taken from `prompt.answer_classes` and never from the transcript.
- **Classifier:** only needed when `answer_classes` contains `OUI_REPETE` or `NON_REPETE`.
- **TTS:** `useSpeech().speak()` cancels whatever is still speaking. Stop TTS before recording, or the microphone will hear the phone.
- **Microphone:** it needs an `expo-audio` config plugin entry in `app.json` (permissions text in French) and, for iOS, `NSMicrophoneUsageDescription` in `locales/fr.json`.
- **Name calls by voice:** `useNames()` provides the `dsa_list_names` list for `matchIntent(… knownNames)`.
- **Recording answers:** see §5.6 about `p_spoken_label`.
