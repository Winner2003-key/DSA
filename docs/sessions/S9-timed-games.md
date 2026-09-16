# Brief S9 — Timed games (thinking time + game time)

> **HOLD. Don't start until the owner explicitly says so.** The owner asked on 2026-09-16 to record this feature and implement it later.

You are a senior full-stack engineer (PostgreSQL / Supabase, React Native / Expo) on **DSA — Découverte Sans Alphabet**.

## Read first, completely
1. `docs/sessions/README.md`; `GAME_RULES.md` ("Planned: time limits"); **`GRAPH_SPECIFICATION.md` §9** (the design); §8 and §3
2. Reports: `S3b-game-ux.md` (the reserved header slot, LOCAL `TIREUR_READY`), `S6-rooms.md` (`tireur_ready_at`, `dsa_tireur_ready`), `S8-hardening.md` if it exists, and `S5-admin.md` (whether the settings page exists)

## You own
- `supabase/` (the next free migration number plus `sql-editor/NN_timer.sql`, and regenerating `00`);
- `apps/mobile/**`;
- `apps/admin/**`, only for the settings page if S5 left it unfinished;
- `packages/core` additive (offline mirror).

## Before building, confirm with the owner (ask at the start of the session)
1. Do rewinds ("QUESTION") and going back use up game time normally? (Assumed yes.)
2. Can the Tireur end the thinking time early with "Je suis prêt"? (Assumed yes.)
3. In rooms, does the clock start only once both players are present? (Assumed yes.)
4. AI Tireur: no thinking time. AI Découvreur: does the human Tireur still get the thinking time? (Assumed yes.)

## Deliver
1. **Settings:**
   - `app_settings` (single row, or key/value) with `think_seconds default 40` and `play_seconds default 120`, bounds-checked (for example 10–600);
   - RLS: admins write, the RPC reads;
   - copied into `game_sessions.settings` at creation, so a running game never changes.
2. **Server-authoritative clock:**
   - `think_ends_at` is set when the Tireur has the card and both players are present;
   - the thinking phase ends at `think_ends_at` or at `dsa_tireur_ready` (early), and then `play_ends_at = now() + play_seconds`;
   - every mutating RPC first checks the deadline; after it, the session becomes **`TIME_UP`** (new status, `winner` null, both lose) and the call raises `DSA_TIME_UP`;
   - `dsa_check_time(session)` lets idle clients trigger it;
   - the state JSON includes `phase` (`THINKING`|`PLAYING`), `think_ends_at`, `play_ends_at` and **`server_now`**, so clients compute the countdown without clock skew;
   - moves arriving right at the deadline: the server decides, using a single `now()` per call.
3. **App:**
   - a countdown ring in the header slot S3b reserved: the thinking phase (Tireur: "Réfléchis au chemin…", Découvreur: "Le Tireur réfléchit…") and the game phase;
   - warnings at 30 s and 10 s (a haptic, a subtle sound);
   - a **Temps écoulé** result screen: both lose, then the revealed path **and** the book path to the secret, so players still learn from it;
   - LOCAL: the thinking phase replaces the client-only `TIREUR_READY`;
   - rooms: synchronized through realtime.
4. **Admin:** the "Réglages" page (S5 feature 6), if it isn't already built: edit both durations, with bounds and a help text.
5. **Offline service:** the same timer rules, for demos and tests.

## Verification
- SQL (PGlite, both fresh and the upgrade path): deadlines, early ready, `TIME_UP` from any RPC, `dsa_check_time`, the settings snapshot, bounds, no secret leak;
- core and mobile tests (fake clock): the countdown from `server_now`, warnings, the time-up flow in each mode;
- `expo-doctor`, and the web export;
- screenshots.

## Report
Write `docs/sessions/reports/S9-timed-games.md` with the owner's answers to the 4 questions, files and outputs, **the exact SQL to paste**, and open questions.
