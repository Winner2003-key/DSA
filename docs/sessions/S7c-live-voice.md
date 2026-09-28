# Brief S7c — A room in Voix mode is a live call (LiveKit)

Senior React Native / Expo engineer, on **DSA**. Repo: `/home/winner/projects/DSA`. Run alone: check `git status` first.

**Work style (owner's orders):** go straight to the point. No screenshots. **Don't write new tests.** Don't narrate or explain in the chat; just do the work. Read only what's listed below.

## Goal
In a room (HUMAN_VS_HUMAN) with **Voix**, the two players are on a **live call**. Nothing is transcribed. The Tireur ends the game with **Trouvé** or **Pas trouvé**. There are call limits. The contract is `GAME_RULES.md` → "Voix in a room is a call" and "Call limits"; read both. The Voix mode of AI_TIREUR, AI_DECOUVREUR and LOCAL (speech recognition) is unchanged.

## Read (only this)
- `docs/sessions/CONTEXT.md`.
- The code: `apps/mobile/src/rooms/**`, `views/room-table.tsx`, `views/game-table.tsx`, and where `voice-play.tsx` branches on VOICE for rooms. `dsa_abandon`, `dsa_tick` and `dsa_check_time` in `supabase/sql-editor/06_timer.sql`, and the `app_settings` timer defaults. `supabase/functions/transcribe/` as the Edge Function pattern (`core.ts`, `index.ts`, `dashboard-single-file.ts`, and the bundling script `npm run voice:bundle-function`). The admin `apps/admin/src/lib/settings-repository.ts` and its Réglages page.
- **WebFetch at most 2 pages:** the LiveKit Expo quickstart (packages and plugin for Expo SDK 57), and LiveKit token generation in Deno. For the web, use `livekit-client`.

## You own
`apps/mobile/**`; `apps/admin/**` (Réglages and settings only); `supabase/functions/livekit-token/**`; `supabase/migrations/0011_room_call.sql` = `supabase/sql-editor/08_room_call.sql` (identical, idempotent, stops with a clear message if `07` is missing); `00_all_migrations.sql` regenerated with `build.sh` (never hand-edited); `supabase/sql-editor/README.md`; `VOICE.md` (a new section, "Appel dans une salle").

## Build

### 1. SQL (`0011` / `08_room_call.sql`)
- **`app_settings`**, editable in admin Réglages: `call_max_seconds` 300, `call_daily_minutes_per_player` 40, `call_monthly_budget_minutes` 4500 (90% of LiveKit's free 5,000; each phone counts), `call_day_timezone` 'UTC'. A game copies what it needs into its settings at creation, like the timer durations.
- **Call clock.** When a VOICE room game enters play (the end of Tireur-ready), set `call_started_at` and `call_ends_at = start + least(call_max_seconds, both players' minutes left today)`. `dsa_tick` / `dsa_check_time` end the game at `call_ends_at` like the existing time-up: `TIME_UP` + a move `{event:'CALL_TIME_UP'}`. If the game timer ends earlier, it wins.
- **`dsa_declare_result(p_session_id uuid, p_found boolean)`**, shaped like `dsa_abandon`. Tireur only; HUMAN_VS_HUMAN + VOICE; game in play; otherwise a `DSA_*` error. `true` → `DISCOVERED` as a normal discovery (the result screen must work). `false` → `ABANDONED` + a move `{event:'NOT_FOUND', by_role:'TIREUR'}`. Revoke and grant like the others.
- **Usage.** `call_usage` (user, session, started_at, seconds). RLS: own rows only. When the game ends, both players are charged `least(ended_at, call_ends_at) - call_started_at`.
- **`dsa_call_allowance()`** → `{minutes_left_today, daily_minutes, max_seconds, available}`. `available` is false when the monthly budget is used up. The day resets at midnight in `call_day_timezone`.
- **Refuse only at the start:** creating or joining a VOICE room, Tireur-ready, rematch. Error `DSA_CALL_DAILY_LIMIT` (a player has < 1 min left) or `DSA_CALL_BUDGET_EXHAUSTED`, with French messages. **Never cut a running game** except at `call_ends_at`.

### 2. Edge Function `livekit-token`
- JWT required (no JWT → 401). Body `{session_id}`. Using the service role, check that the caller is one of the two players, the room is VOICE, the game is in play and `now < call_ends_at`. Otherwise 403 `DSA_CALL_*` + `message_fr`.
- Returns `{url, token, ends_at}`. Room `dsa-<session_id>`; identity = the user id; name = the display name; **audio only** (microphone publish, subscribe, no data); TTL = the time until `ends_at` + 60 s. If the RoomService API is easy, create the room with `maxParticipants: 2` and a short `emptyTimeout`.
- Secrets `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; missing → 503 `DSA_CALL_NOT_CONFIGURED`. Ship `core.ts`, `index.ts` and a generated `dashboard-single-file.ts` (extend the existing bundling script).

### 3. App: the call layer
- `src/call/`: a `VoiceCall` interface (`connect`, `disconnect`, `setMuted`; state `connecting | connected | reconnecting | failed`; the other player present; speaking flags). `call.native.ts` uses `@livekit/react-native`; `call.web.ts` uses `livekit-client`. Get the token with `supabase.functions.invoke('livekit-token')`.
- **Expo Go:** a lazy `require` in a try, never crashing at import. When it fails, show « L'appel nécessite l'application DSA installée. Sur ce téléphone, tu peux jouer depuis le navigateur. » Trouvé / Pas trouvé still work.
- Loudspeaker by default, echo cancellation and noise suppression on, the iOS audio session set for a call (LiveKit `AudioSession`), and the microphone permission prompt. Add no audio processing of your own.
- Install with `npx expo install`, and add the plugins to `app.json`. In `eas.json`, add an iOS internal-distribution device profile (`ios.simulator: false`).

### 4. App: screens (French, existing components)
- **Lobby, and the Voix choice in room creation:** « Appel limité à N min · il te reste M min d'appel aujourd'hui », from `dsa_call_allowance()` (never hard-code the numbers). When Voix isn't available: disable it, say why, preselect Boutons.
- **The call screen** replaces the room's voice-play table from the end of Tireur-ready to the end of the game.
  - **Both players:** the other player's name and role; the connection state (« Connexion… », « En ligne », « Reconnexion… », « L'appel a échoué — Réessayer »); a big « Micro ouvert / Micro coupé » toggle; a speaking indicator for each player; « Quitter la partie » (the existing abandon).
  - **No call countdown.** In a timed game, show the existing game timer only. Show a banner and a haptic at 1 min and at 30 s before `call_ends_at` (« L'appel se termine dans 1 minute »), in a timed game only if the call ends before the game timer.
  - **Tireur:** the secret card, plus **« Trouvé »** and **« Pas trouvé »**, each with a one-tap confirmation → `dsa_declare_result`.
  - **Découvreur:** « Pose les questions du livre. Le Tireur dira quand tu as trouvé. »
- **Any end** (declared, time up, call time up, abandoned, the other player gone): disconnect and go to the usual result screen. Also disconnect by yourself at `ends_at`, and call `checkTime` then.
- **Result screen for a call game:** hide the question statistics and the players' path. Show « Temps d'appel écoulé » for `CALL_TIME_UP` and « Pas trouvé » for `NOT_FOUND`.
- **Rematch** starts a new call.

### 5. `VOICE.md` → "Appel dans une salle"
The owner's steps, short: LiveKit keys → Supabase secrets → deploy `livekit-token` (dashboard single file, with Verify JWT on; or the CLI with `--use-api`) → run `08_room_call.sql` → the EAS development build (`eas build -p android --profile development`, install the APK, `npx expo start --dev-client`) → iPhone (paid Apple account, `eas device:create`, the iOS profile) or Safari on the web.

## Check once, at the end (nothing else)
`npm run typecheck --workspaces --if-present`, `cd apps/mobile && npx expo export -p web` (a broken web bundle breaks the Vercel deploy), and one `npx jest --ci` in `apps/mobile`. If an existing test fails because the room's VOICE behaviour changed on purpose, update or remove that case; don't add new ones.

## Report
`docs/sessions/reports/S7c-live-voice.md`, **at most 400 words**: the files changed, the package versions, the check summary lines, the owner's steps in order, and open questions. Nothing else.
