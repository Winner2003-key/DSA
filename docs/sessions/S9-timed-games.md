# Brief S9 — Optional timer, name changes, and the book's path for a lost game

You are a senior full-stack engineer (PostgreSQL / Supabase, React Native / Expo, Next.js) on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game. Repo: `/home/winner/projects/DSA`.

**Start after S6 (rooms) and S5b (admin Homonymes) are finished and committed**: you touch `apps/mobile` and `apps/admin` too. Don't run at the same time as S7b.

## Read first, completely
1. `docs/sessions/README.md`: global rules. **No Docker**, no commit, French UI. **Public repo: never write the source book's title, author or organisation**; the book graph is `livre`.
2. `GAME_RULES.md`: especially "Time limits, name changes and learning from a lost game".
3. **`GRAPH_SPECIFICATION.md` §9** (the design you implement), plus §3, §7, §8 and §10.
4. `DATABASE_SCHEMA.md`.
5. Reports: `S3b-game-ux.md` (the setup screen, the reserved header slot, `PathGraph`, LOCAL `TIREUR_READY`), **`S6-rooms.md`** (`tireur_ready_at`, `dsa_tireur_ready`, rooms, rematch, realtime), `S5-admin.md` and `S5b-admin-homonyms.md` (the admin structure), and `S2-database.md` (verifying SQL without Docker).

## You own
- `supabase/`: `migrations/0009_timer.sql`, `sql-editor/06_timer.sql`, regenerating `00_all_migrations.sql`, additions to `90_tests.sql`, and `DATABASE_SCHEMA.md`;
- `apps/mobile/**`;
- `apps/admin/**`, **only** the new Réglages page and its link;
- `packages/core`: additive changes (`solutionPath`, the timer and redraw mirror for the offline service), with tests.

## First: confirm with the owner (ask at the start, then record the answers in your report)
1. **Name change:** is it allowed (a) only during the thinking phase or before the first answer, or (b) any time during the game, restarting the questions from the start? Default: **(b)**, since the owner said "during the game".
2. **With the timer:** does a name change restart the thinking time (default **yes**) and leave the game clock running once it has started (default **yes**)?
3. Do rewinds ("QUESTION") and going back use game time normally? (Default **yes**.)
4. In rooms, does the clock start only once both players are present? (Default **yes**.)
5. After a **discovered** game, should the book's path also be offered as a secondary "Voir le chemin du livre" button? (Default **yes**.)

## Deliver

### 1. The timer is optional
- **"Préparer la partie"** (S3b) and **room creation** (S6) get a checkbox **« Jouer avec le chronomètre »**, unchecked by default, with a one-line explanation using the current durations (for example "40 s pour réfléchir, puis 2 min pour trouver").
- In rooms, the creator's choice applies to both players, and the lobby shows it.
- Send `settings.timed`. Server: extend `dsa_normalize_settings` to accept `timed` (boolean) and copy the durations from `app_settings` when it's true (§9). `dsa_rematch` keeps the settings.

### 2. Settings storage and the admin "Réglages" page
- `app_settings`: a single row with `think_seconds`, `play_seconds` and `max_redraws`, the defaults and bounds from §9, and RLS (admins write; RPCs read through SECURITY DEFINER).
- Admin page `/reglages`: edit the three values with bounds and help text, linked from the admin header. Mock mode keeps them in memory.

### 3. Server-authoritative clock (timed games only), per §9
- `think_ends_at`, `play_ends_at`, the new status `TIME_UP`, `DSA_TIME_UP`, `dsa_check_time`.
- State JSON: `timed`, `phase`, `think_ends_at`, `play_ends_at`, `server_now`.
- A move that arrives right at the deadline is decided by a single `now()` per call.
- Untimed games behave exactly as today (every existing test still passes).

### 4. Name change (timed or not), per §9 and the owner's answers
- `dsa_redraw_secret`, `game_secrets.previous_node_ids`, `DSA_NO_REDRAW_LEFT`, `redraws_used` / `redraws_left` in the state, and the `SYSTEM` move `REDRAW`.
- **Tireur app:** a **« Changer de nom »** button near the card, with the number left ("2 restants"). It asks for confirmation ("Tu ne trouves pas ce nom dans le livre ?"), then shows the new card with a flip.
- **Découvreur app:** a short notice "Le Tireur a changé de nom", which also appears in the conversation timeline.
- AI Tireur: not applicable. AI Découvreur mode: the human Tireur can redraw.

### 5. The book's path when the name wasn't found
- `dsa_get_solution_path` (SQL) and `solutionPath(ix, secretNodeId)` (core), per §9. It's available only after the end, and the security tests prove it's refused before.
- **Result screen:**
  - `TIME_UP` / `ABANDONED` → "Temps écoulé" / "Partie arrêtée", the name, the description only when homonyms exist, then **"Voici le chemin du livre pour trouver <NOM>"** with the `PathGraph` animation of the solution path, **instead of** the players' path;
  - `DISCOVERED` → unchanged, plus the secondary "Voir le chemin du livre" if the owner confirms.
- The stats still describe what the players did.

### 6. The timer in the app
- A countdown ring in the header slot S3b reserved.
  - **Thinking phase** — Tireur: "Réfléchis au chemin…" with "Je suis prêt"; Découvreur: "Le Tireur réfléchit…".
  - **Game phase:** the ring for both players.
- Warnings at 30 s and 10 s (haptic, subtle colour change); **reduced motion respected**.
- The countdown is computed from `server_now`, and resynchronized on each state refresh and realtime event.
- Rooms stay synchronized, and a device that reconnects shows the right time left.
- LOCAL: the thinking phase shows on the Tireur's turn, then "Passe le téléphone".

### 7. Offline service
Mirrors all of the above (timer with an injectable clock, redraws, solution path) for demos and tests.

## SQL delivery (no Docker)
- Re-runnable.
- Verified like S2 (libpg-query plus PGlite in your scratchpad, not the repo), on a fresh database (`00 → 01 → 90`) **and** on the owner's upgrade path (existing project → `06_timer.sql` → `90`).
- **Tests:**
  - an untimed game is unchanged;
  - timed: deadlines, early ready, `TIME_UP` from any RPC after the deadline, `dsa_check_time`, the settings snapshot (changing `app_settings` mid-game doesn't affect a running game), bounds;
  - redraws: max 2, never the same name twice, the reset behaviour from the owner's answer, and the Découvreur never learns which names were drawn;
  - solution path: correct for every playable secret of `mini`, with the same shape as `path[]`, refused before the end;
  - no secret leaks in any new field.

## Verification (paste the output)
- core, mobile and admin `npm test` / `typecheck`; `npm run build --workspace apps/admin`; `expo-doctor`; `npx expo export -p web --clear`;
- fake-clock tests: the countdown from `server_now`, the warnings, the time-up flow in each mode, a redraw during the thinking phase and during play, and the solution path rendered on a lost game;
- headless screenshots (offline mode) in `docs/sessions/reports/S9-screens/`: setup with the checkbox, the thinking phase, the countdown, a redraw, time up with the book's path, and the admin Réglages page.

## Report
Write `docs/sessions/reports/S9-timed-games.md` with:
- the owner's answers to the 5 questions;
- files and outputs;
- **the exact SQL file to paste** (`06_timer.sql`, then `90_tests.sql`);
- deviations and open questions.
