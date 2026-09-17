# Brief S9 — Optional timer, name changes before the start, and the book's path at the end of every game

You are a senior full-stack engineer (PostgreSQL / Supabase, React Native / Expo, Next.js) on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game played by voice or buttons. Repo: `/home/winner/projects/DSA`.

## Read first, completely
1. `docs/sessions/README.md`: global rules. **No Docker**, no commit, French UI. **Public repo: never write the source book's title, author or organisation**; the book graph is `livre`.
2. `GAME_RULES.md`: especially **"Time limits, name changes and learning from a lost game"** (points 1–5, the owner's final decisions).
3. **`GRAPH_SPECIFICATION.md` §9** (the design you implement: clock, preparation phase and name change, end-of-game statistics and solution path), plus §3, §7, §8 and §10.
4. `DATABASE_SCHEMA.md`.
5. Reports:
   - `S3b-game-ux.md`: setup screen, header slot, `PathGraph`, result screen.
   - **`S6-rooms.md`**: `tireur_ready_at`, `dsa_tireur_ready`, `dsa_start_play`, `dsa_assert_tireur_ready`, rooms, rematch, realtime. **Read its §6 open question 2 and §9 "Notes for S9".**
   - **`S7b-voice-app.md`**: voice play; the timer must work with voice, and nothing may listen during the preparation phase.
   - `S5-admin.md` and `S5b-admin-homonyms.md`: admin structure.
   - `S2-database.md`: verifying SQL without Docker.

## Owner decisions (final; don't ask again)
1. **Name change only before the game starts.** The Tireur may draw another name (max 2 per game) **only while looking at the card, before "Je suis prêt"**. Once the questions have started, no change; the Tireur can only abandon.
2. With the timer, a name change gives a **fresh thinking time**.
3. **The game time is fixed.** Rewinds, going back and wrong name calls all consume the same time; nothing extends or resets it.
4. In rooms, the clock starts only once **both players are present**.
5. **The end screen of every game** (discovered, time up or abandoned):
   - shows the game card first: outcome, name, **statistics** (questions, NON, back-steps, rewinds) and, **if the timer was on and the name was found, the time taken** ("Trouvé en 1 min 12 s sur 2 min");
   - then **the book's actual path to the name** (solution path) in the animated `PathGraph`. The **players' own path is no longer shown on the result screen**; it's still available during play under "Voir le chemin".

   The owner likes the current `PathGraph` rendering: keep it.

## You own
- `supabase/`: `migrations/0009_timer.sql`, `sql-editor/06_timer.sql`, regenerating `00_all_migrations.sql`, additions to `90_tests.sql`, and `DATABASE_SCHEMA.md`;
- `apps/mobile/**`;
- `apps/admin/**`, **only** the new Réglages page and its link;
- `packages/core`: additive changes (`solutionPath`, the timer, preparation and redraw mirror for the offline service), with tests.

## Deliver

### 1. The optional timer
- **"Préparer la partie"** and **room creation** get a checkbox **« Jouer avec le chronomètre »**, unchecked by default, with a one-line explanation using the current durations ("40 s pour réfléchir, puis 2 min pour trouver").
- In rooms, the creator's choice applies to both players, and the lobby shows it read-only.
- `settings.timed` goes through `dsa_create_session(p_settings)`. `dsa_normalize_settings` accepts `timed` (boolean) and, when it's true, **the server copies** `think_seconds` and `play_seconds` from `app_settings`. `max_redraws` is always copied. `dsa_rematch` keeps the settings.

### 2. Settings storage and the admin "Réglages" page
- `app_settings`: a single row with `think_seconds` (40, 10–600), `play_seconds` (120, 30–1800) and `max_redraws` (2, 0–5). RLS: admins write; RPCs read through SECURITY DEFINER.
- Admin page `/reglages`: edit the three values with bounds and French help text, linked from the admin header. Mock mode keeps them in memory.

### 3. A server-side preparation phase for every human Tireur
- Generalize S6's HUMAN_VS_HUMAN `tireur_ready_at` to **LOCAL and AI_DECOUVREUR**: these modes now also start with `tireur_ready_at` null.
  - `dsa_ask`, `dsa_guess` and `dsa_ai_decouvreur_step` raise `DSA_TIREUR_NOT_READY` until `dsa_tireur_ready`.
  - AI_TIREUR is ready at creation.
- The app's client-only LOCAL `TIREUR_READY` step now follows the server phase.
- **Card reading (S6 §6.2):** `dsa_get_my_secret` is refused (`DSA_WAITING_FOR_PLAYER`) while a room is still WAITING. In a timed game, the thinking clock starts when the phase starts (both players present), so reading the card earlier gives no advantage.
- **Voice (S7b):** nothing listens during this phase.

### 4. Server-authoritative clock (timed games only), per §9
- `think_ends_at` is set when the preparation phase starts: at creation for LOCAL and AI_DECOUVREUR, and in `dsa_start_play` when a room becomes PLAYING. `dsa_tireur_ready` or the deadline ends it.
- `play_ends_at = end of thinking + play_seconds`, **never changed afterwards**.
- New status `TIME_UP` (winner null), `DSA_TIME_UP` (checked first in every mutating RPC, for example in `dsa_assert_tireur_ready` and the play RPCs), and `dsa_check_time(session)` for idle clients.
- State JSON: `timed`, `phase` (`THINKING`|`PLAYING`), `think_ends_at`, `play_ends_at`, `server_now`.
- A move that arrives right at the deadline is decided by one `now()` per call.
- **Untimed games** behave exactly as today, except that the preparation phase now exists in LOCAL and AI_DECOUVREUR.

### 5. Name change before the start
- `dsa_redraw_secret(p_session_id)`: TIREUR only, **only during the preparation phase**, otherwise `DSA_GAME_STARTED`.
  - It excludes names already drawn (`game_secrets.previous_node_ids`, private).
  - It raises `DSA_NO_REDRAW_LEFT` after `max_redraws`.
  - In a timed game it restarts `think_ends_at`.
- State: `redraws_used`, `redraws_left`, never which names. A `SYSTEM` move with `payload.event = 'REDRAW'`.
- **Tireur app (preparation view):**
  - **« Changer de nom »** with "2 restants";
  - a confirmation ("Tu ne trouves pas ce nom dans le livre ?");
  - the new card flips in.
  - The button disappears once the game has started; from then on only "Abandonner".
- **Découvreur app:** "Le Tireur a changé de nom" during the wait.

### 6. End of every game: statistics card, then the book's path
- `dsa_get_solution_path(p_session_id)`: players, **only once the session is DISCOVERED, TIME_UP or ABANDONED** (refused before, and a security test proves it). It uses the same entry shape as `path[]`, plus the secret. Core mirror: `solutionPath(ix, secretNodeId)`.
- `dsa_get_revealed_path().stats` gains `timed`, `play_seconds` and `found_in_seconds` (null unless discovered).
- **Result screen for every outcome:**
  - the game card: "Trouvé !" / "Temps écoulé" / "Partie arrêtée", the name, the description only when homonyms exist, the stats, and **"Trouvé en X sur Y"** when timed and discovered;
  - then **"Le chemin du livre pour trouver <NOM>"**: the `PathGraph` animation of the **solution path**.
  - Remove the players' own path from the result screen. Keep the "Rejouer" flows (rooms rematch included).
- **During play**, "Voir le chemin" still shows the players' own traversed path.

### 7. The timer in the app
- A countdown ring in the header slot S3b reserved, and in the `think-timer-slot` views S6 prepared (`TireurReadyView`, `DecouvreurWaitingView`).
  - **Thinking phase** — Tireur: "Réfléchis au chemin…" with "Je suis prêt" and "Changer de nom"; Découvreur: "Le Tireur réfléchit…".
  - **Game phase:** the ring for both players.
- Warnings at 30 s and 10 s (haptic, subtle colour change); reduced motion respected.
- The countdown is computed from `server_now`, and resynchronized on every state refresh and realtime event. A device that reconnects shows the right time left.
- Timing out while recording voice cancels the recording cleanly.
- LOCAL: the thinking phase on the Tireur's turn, then "Passe le téléphone".

### 8. Offline service
Mirrors all of the above (timer with an injectable clock, preparation phase, redraws, stats, solution path) for demos and tests.

## SQL delivery (no Docker)
- Re-runnable.
- Verified like S2 (libpg-query plus PGlite in your scratchpad, not the repo), on a fresh database (`00 → 01 → 90`) **and** on the owner's upgrade path (a project that already has `00`–`05` → `06_timer.sql` → `90`).
- **Tests:**
  - untimed games are unchanged, apart from the new preparation phase in LOCAL and AI_DECOUVREUR;
  - timed: deadlines, early ready, `TIME_UP` from any RPC after the deadline, `dsa_check_time`, the settings snapshot (changing `app_settings` mid-game doesn't affect a running game), bounds, the clock starting only when both players are present;
  - redraws: max 2, never the same name twice, **refused once the game has started**, a fresh thinking time, and no leak of drawn names;
  - solution path: correct for every playable secret of `mini`, with the same shape as `path[]`, refused before the end;
  - `found_in_seconds`;
  - no secret leaks in any new field.

## Verification (paste the output)
- core, voice, mobile and admin `npm test` / `typecheck`; `npm run build --workspace apps/admin`; `expo-doctor`; `npx expo export -p web --clear`;
- fake-clock tests: countdown from `server_now`, warnings, time up in each mode, redraw during the preparation phase (and refused after), result screen stats with "Trouvé en…", and the solution path rendered for each outcome;
- headless screenshots (offline mode) in `docs/sessions/reports/S9-screens/`: setup with the checkbox, the thinking phase with "Changer de nom", the countdown in play, time up, a discovered-game result with "Trouvé en…" and the book's path, and the admin Réglages page.

## Report
Write `docs/sessions/reports/S9-timed-games.md` with:
- files and outputs;
- **the exact SQL to paste** (`06_timer.sql`, then `90_tests.sql`);
- deviations and open questions;
- notes for S7c (live voice) and S8.
