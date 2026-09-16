# Brief S6 — Rooms: two players on two devices (Supabase Realtime)

You are a senior React Native / Expo engineer with solid PostgreSQL and Supabase Realtime skills, on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game. Repo: `/home/winner/projects/DSA`.

**Start only after S3b is finished** (you both own `apps/mobile`).

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no commit, French UI)
2. `GAME_RULES.md`; `GRAPH_SPECIFICATION.md`, all of it, especially §3 (realtime), §7, §8, **§9 (the timer is not implemented, but your "Tireur ready" step must be easy to turn into its thinking phase)** and §10 (direct phrasing)
3. `DATABASE_SCHEMA.md`
4. Reports: `S3-expo.md` (§6 "For S6"), `S3b-game-ux.md`, `S2-database.md`, and `S7a-voice-foundations.md` if it exists

## You own
`apps/mobile/**`; `supabase/migrations/0008_rooms.sql`, `supabase/sql-editor/05_rooms.sql`; regenerating `00_all_migrations.sql` with `build.sh` (it must then include 0006, 0007 if present, and 0008); additions to `90_tests.sql` and `DATABASE_SCHEMA.md`.

## Deliver
1. **Home → "Jouer avec un ami"** (enable it):
   - **Créer une partie:** "Préparer la partie" (from S3b): my role, and **Façon de jouer: Voix / Boutons**. The creator chooses for both players (`settings.input_mode`), and Voix stays "Bientôt" until S7b. This creates a HUMAN_VS_HUMAN session.
   - **Rejoindre une partie:** type a code (auto-format `DSA-` and digits, accept lowercase or no dash), **or scan a QR code**. Deep link `dsa://rejoindre/DSA-1234`; web URL `/rejoindre/DSA-1234` (expo-router route). The QR uses `react-native-qrcode-svg` (Expo Go compatible). Check that a camera scanner is available in Expo Go (`expo-camera`); if not, the QR is for phones scanning with their system camera.
2. **Lobby:**
   - the code shown big, plus a **Partager** button (React Native `Share`) and the QR code;
   - the two seats with names, and "En attente du Découvreur…" (or Tireur);
   - live **presence** for each player (Realtime presence on channel `room:<ROOM_CODE>`): connected, away, disconnected;
   - leave or cancel.
3. **Tireur first, across devices** (the server version of S3b's LOCAL `TIREUR_READY`):
   - **SQL 0008:** `game_sessions.tireur_ready_at timestamptz`, and RPC `dsa_tireur_ready(p_session_id)` (TIREUR only).
   - In HUMAN_VS_HUMAN, `dsa_ask` and `dsa_guess` raise `DSA_TIREUR_NOT_READY` until it's set; other modes set it at creation. Expose `tireur_ready` in the state JSON.
   - **Tireur device:** card, then "Je suis prêt". **Découvreur device:** "Le Tireur découvre sa carte…".
   - Keep this one clearly named phase, so S9 can put the 40 s thinking timer on it.
4. **Realtime:**
   - implement `SupabaseGameService.subscribe` (`postgres_changes` on `game_sessions` `id=eq.…`, `game_moves` and `game_players` `game_session_id=eq.…`) and refetch `dsa_get_state` on each event, with debouncing (~150 ms);
   - set `supportsRealtime = true`;
   - keep polling (5 s) only as a fallback while the channel isn't `SUBSCRIBED`;
   - handle app background → foreground (AppState: resubscribe and refetch), network loss (banner "Connexion perdue… reconnexion"), and the other player leaving (banner, plus "Abandonner" / "Attendre").
   - Each device only renders its own role's view.
5. **Stale rooms:**
   - SQL `dsa_cleanup_stale_sessions(p_idle interval default '6 hours')` marks WAITING/PLAYING sessions with no activity in that time as ABANDONED (internal, not granted to clients);
   - call it opportunistically at the start of `dsa_create_session` and `dsa_join_session` (cheap, indexed);
   - document an **optional** pg_cron schedule the owner can add from the dashboard (Integrations → Cron).
6. **End of game on both devices:** DISCOVERED or ABANDONED sends both players to the result screen with the path graph (S3b). **Rejouer** offers "Même rôles" / "Inverser les rôles", creating a new room and taking the other player there through a Realtime broadcast `rematch` event, which they accept.

## SQL delivery (no Docker)
- Make it re-runnable.
- Verify it as S2 did: `libpg-query` plus `@electric-sql/pglite`, installed in your scratchpad, not the repo. Check both a fresh `00 → 01 → 90` and the owner's upgrade path `(existing) → 05 → 90`.
- Tests:
  - `DSA_TIREUR_NOT_READY`, and the ready flow;
  - cleanup marks only idle sessions, and never touches finished ones;
  - a joiner after cleanup gets `DSA_ROOM_NOT_FOUND`;
  - the state JSON includes `tireur_ready` without leaking the secret.

## Tests and verification (paste the output)
- core and mobile `npm test` / `typecheck`;
- `expo-doctor`; `npx expo export -p web --clear`;
- unit tests:
  - code formatting and parsing;
  - `subscribe` debounce and fallback polling (with a mocked channel);
  - the lobby state machine (waiting, both present, ready, playing, other player gone);
  - rematch;
- **two-browser test:** two headless browser contexts **only if** `apps/mobile/.env` exists **and** the owner agrees at the start of the session (it writes test sessions to their hosted Supabase). Use graph `mini`, and abandon every session created. Otherwise skip it and say so.
- a **manual two-phone checklist** for the owner in the report (Expo Go on two phones, and phone + web).

## Report
Write `docs/sessions/reports/S6-rooms.md` with:
- files and outputs;
- **the exact SQL file to paste** (`05_rooms.sql`);
- the manual checklist;
- deviations and open questions;
- notes for S7b and S7c (the Realtime channel `room:<code>` is already joined for presence; reuse it for the WebRTC signaling events `offer`/`answer`/`ice`/`hangup`).
