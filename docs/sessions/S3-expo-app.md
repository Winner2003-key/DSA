# Brief S3 — `apps/mobile`: the Expo game app (Android, iOS and web)

You are a senior React Native / Expo engineer and product designer on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game. Repo: `/home/winner/projects/DSA` (npm workspaces; Node 22).

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no git commit, stay in your folders, French UI)
2. `GAME_RULES.md`
3. `GRAPH_SPECIFICATION.md`: all of it, **especially §1 (platform), §3 (RPCs), §6 (reveal) and §7 (wave-1 decisions)**
4. `DATABASE_SCHEMA.md`: the RPC signatures, the exact JSON shapes and the error codes you will call
5. `docs/sessions/reports/S1-core.md` and `S2-database.md`: what already exists and how it behaves
6. `packages/core/src/index.ts`: the engine, rules and intents you may reuse

## You own
`apps/mobile/**` only. You may add `apps/mobile` to the root lockfile with `npm install` (other wave-2 sessions install at the same time; if npm fails with a lock or ENOTEMPTY error, wait 30 s and retry; **never delete `package-lock.json`**). Don't edit `packages/core`; if you need a change there, describe it in your report.

## Constraints
- **Must run in Expo Go.** Only use modules included in Expo Go for the current SDK: expo-router, expo-speech, expo-haptics, react-native-reanimated, react-native-svg, @react-native-async-storage/async-storage, react-native-safe-area-context, expo-linear-gradient, expo-font and similar. No custom native code. No speech-to-text or WebRTC yet (that is S7).
- **Must export for the web:** `npx expo export -p web` produces static `dist/`, to be deployed on Vercel. Add `apps/mobile/vercel.json` (SPA rewrites to `index.html`) and a "Deploy web on Vercel" section in `apps/mobile/README.md` (root directory `apps/mobile`, build `npx expo export -p web`, output `dist`, env vars).
- **EAS:** `eas.json` with profiles `development` (dev client, internal) and `preview` (Android **APK**, `buildType: "apk"`, internal distribution), plus `app.json`/`app.config.ts` with the name `DSA`, slug `dsa`, scheme `dsa`, an Android package placeholder `com.pahilabs.dsa`, and a French locale. Use the latest stable Expo SDK (`npx create-expo-app@latest` with the TypeScript template, then trim it). Monorepo: make Metro resolve the `@dsa/core` workspace package (recent SDKs detect workspaces automatically; verify it).
- **Env:** `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `apps/mobile/.env` (gitignored). Commit `.env.example`. The owner will fill in the real values.
- **Security:** the client never selects from tables. It calls RPCs only, after `supabase.auth.signInAnonymously()` with a persisted session (AsyncStorage). A Découvreur screen must never call `dsa_get_my_secret` or render anything from it.
- **French UI**, everywhere, including errors (map every `DSA_<CODE>` to a friendly French message).

## Architecture
```
apps/mobile/
  app/                         expo-router routes (thin: layout + composition only)
    _layout.tsx  index.tsx (Accueil)  jouer/index.tsx (choix du rôle et du mode)
    partie/[sessionId].tsx     (game screen; picks the Tireur or Découvreur view from my role)
    resultat/[sessionId].tsx   (discovery + revealed path)
  src/
    services/game-service.ts   interface GameService { createSession, joinSession, getState, getMySecret, ask, answer, guess, confirmGuess, goBack, rewind, aiDecouvreurStep, abandon, getRevealedPath, listNames }
    services/supabase-game-service.ts   implementation over the RPCs (typed, maps DSA_ errors)
    services/offline-game-service.ts    implementation over @dsa/core GameEngine + packages/core/fixtures/mini-graph.json,
                                        enabled only when EXPO_PUBLIC_DSA_OFFLINE=1 (dev and demo; shows a visible "MODE HORS LIGNE (démo)" badge)
    state/                     a game hook (useGame(sessionId)): polling, and later realtime, over the GameService; derives whose turn it is
    speech/tts.ts              interface TextToSpeech; expo-speech on native, speechSynthesis on web; fr-FR voice; mute toggle
    speech/stt.ts              interface SpeechToText (placeholder only; S7 implements it)
    components/                buttons, answer pad, prompt card, path trail, name card, …
    i18n/fr.ts                 every UI string
    theme/                     colors, typography, spacing
```
The UI never contains game-rule logic; it renders the state JSON and calls the service.

## Screens and behaviour (this wave: LOCAL, AI_TIREUR, AI_DECOUVREUR; rooms come in S6)
- **Accueil:**
  - "DSA", "Découverte Sans Alphabet";
  - buttons **Jouer**, **Jouer avec un ami** (visible, disabled, "Bientôt"), **Explorer** (disabled, "Bientôt").
- **Jouer:**
  - choose "Je suis le Découvreur" (AI_TIREUR mode) or "Je suis le Tireur" (AI_DECOUVREUR mode);
  - plus "Deux joueurs sur ce téléphone" (LOCAL).
- **Découvreur view:**
  - large prompt card: "Est-ce … ?" plus the prompt text;
  - big **Poser la question** button (voice comes in S7; for now tapping it is the question);
  - **Proposer un nom**: a text field with autocomplete from `dsa_list_names`, accent-insensitive;
  - **Revenir à une question**: pick a step from the trail;
  - the answer arrives as audio via TTS ("Oui.", "Non.", "Oui oui oui !") and as large text;
  - the trail shows only the traversed path (`path`), never future nodes;
  - dead end → a clear message and an invitation to go back.
- **Tireur view:**
  - the secret card (NAME large, description small), with a "cacher / montrer" toggle; in LOCAL mode it's hidden by default, and "pass the phone" interstitials are shown between turns;
  - the current question is read aloud;
  - large buttons **OUI**, **NON** and, only when allowed by `prompt.answer_classes`, **OUI OUI OUI** / **NON NON NON** / **JE NE SAIS PAS**;
  - each button sends the **canonical label** for that class (never raw text), see GRAPH_SPECIFICATION §7;
  - **QUESTION** ×1/×2/×3 (rewind);
  - when there's a pending name call: "Le Découvreur propose : X" with OUI / NON.
  - AI_DECOUVREUR mode: after each Tireur action, call `aiDecouvreurStep` while `awaiting = QUESTION`, with a short "réfléchit…" delay so it feels human, and read the AI's question aloud.
- **Résultat:**
  - 🎉 plus the name and description;
  - "Voici le chemin que vous avez parcouru.";
  - animated vertical path `QUESTION → réponse → … → NOM ⭐` (Reanimated; each step appears in sequence), scrollable and pinch or zoomable where practical;
  - stats (questions, NON, retours);
  - **Rejouer** / **Accueil**.
- **Mobile-first**, with phone-size touch targets (≥56 pt for the answer buttons). Also check the layout at 400 px and desktop widths on web.
- **Design:** use the `frontend-design` skill. The feel is a warm, calm, reverent card game, not a form: big type, strong contrast, answer buttons that feel physical (haptics on native), light and dark themes.

## Tests and verification (all must pass; paste the output in the report)
- `npm run typecheck --workspace apps/mobile` (`tsc --noEmit`)
- `npm test --workspace apps/mobile` (jest-expo):
  - the offline service plays scenario 1 (secret CAÏN) and scenario 7 (rewind) end to end through the `useGame` hook;
  - the Supabase service maps RPC errors to French messages (with a mocked client);
  - the Découvreur view never renders the secret (render test with a state containing a secret in the Tireur data).
- `npx expo-doctor` has no errors (explain any warning left).
- `npx expo export -p web` succeeds.
- If you can, run the web build locally (`npx expo start --web` or serve `dist`) with `EXPO_PUBLIC_DSA_OFFLINE=1`, drive a full offline game with a headless browser, and save screenshots to `docs/sessions/reports/S3-screens/`.

## Report
Write `docs/sessions/reports/S3-expo.md` with:
- the files;
- the test, doctor and export output;
- screenshots (if taken);
- exact commands for the owner: `cd apps/mobile && npx expo start` → scan with Expo Go; web; `eas build -p android --profile preview`;
- deviations and open questions;
- anything S6 (rooms and realtime) and S7 (voice) must know about your service and hook design.
