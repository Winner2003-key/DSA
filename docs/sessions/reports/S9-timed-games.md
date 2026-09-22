# Report S9 — Optional timer, name changes before the start, and the book's path at the end

**Status: done.** Everything in the brief is built and tested.

- **SQL:** `0009_timer.sql`, the paste-ready `06_timer.sql`, the regenerated `00_all_migrations.sql` (0001–0009) and three new blocks (15–17) in `90_tests.sql`. Checked with `libpg-query` and PGlite on a fresh project **and** on the owner's upgrade path, plus **15 mutation checks, all caught**.
- **Core:** `solutionPath` (the book's own way to a name) and `clock.ts` (the timer's rules as pure functions), both additive.
- **Mobile:** the chronometer checkbox, a server-side preparation phase in every mode with a human Tireur, the countdown ring, "Changer de nom", `TIME_UP`, and a result screen that teaches the book's path after every game.
- **Admin:** the new `/reglages` page, linked from the header.

**Test results**

| Workspace | Before | Now |
|---|---|---|
| `packages/core` | 170 | **188** (+ `solution.test.ts`, `clock.test.ts`) |
| `apps/mobile` | 167 | **207** (+ `timer`, `redraw`, `result-solution-path`, 2 voice and 2 service tests) |
| `apps/admin` | 87 | **93** (+ `settings.test.ts`) |
| `packages/voice` | 165 | 165, unchanged |
| `scripts` | 64 | 64, unchanged |
| `90_tests.sql` | blocks 0–14 | + blocks **15 (timer), 16 (name changes), 17 (the book's path)** |

Every typecheck is clean, `npm run build --workspace apps/admin` succeeds, and the Expo web export succeeds. **Nothing was committed.**

**Not verified:** Expo Go on a real phone (haptics, the ring on native SVG), and the hosted Supabase project — the owner's paste of `06_timer.sql` is that check. `expo-doctor` reports **20/21**: three Expo *patch* versions have drifted since S6 (`expo`, `expo-constants`, `expo-router`). No dependency was added or changed in this session (`git diff` on the three package files is empty); it is upstream drift, and bumping them is not this brief's business.

---

## 1. The SQL to paste

For the owner's project, which already has `00`–`05`:

1. SQL Editor → New query → paste **all** of **`supabase/sql-editor/06_timer.sql`** → **Run**. Expect `Success. No rows returned`.
   - It needs `05_rooms.sql`. Without it, it stops with
     `DSA SETUP: this project predates the rooms update; run 05_rooms.sql first, then this file again`.
   - It is safe to run twice.
2. Paste **all** of **`supabase/sql-editor/90_tests.sql`** → **Run**. Expect one row: **`ALL DSA TESTS PASSED`**.
   - The new `90` refuses to run on a project without `06`:
     `DSA TEST SETUP: this project predates the timed-games update; run 06_timer.sql (or the new 00_all_migrations.sql) first`.

A **new** project runs `00 → 01 → 90` as before; the regenerated `00` already contains 0009.

**After that**, the three durations live in the admin app under **Réglages**. They apply to games started afterwards — never to one in progress.

### What changes on the server

| Object | Change |
|---|---|
| `app_settings` | **New table, one row** (`id boolean primary key check (id)`): `think_seconds` (40, 10–600), `play_seconds` (120, 30–1800), `max_redraws` (2, 0–5), `updated_at`, `updated_by`. RLS: admins select and update; no INSERT or DELETE for anyone. Seeded by the migration. |
| `game_sessions.think_ends_at` / `play_ends_at` | New. The two deadlines of a timed game; null otherwise. |
| `game_sessions.status` | The CHECK gains **`TIME_UP`** (winner null, both players lose). The constraint is dropped and re-added, so re-running is safe. |
| `game_secrets.previous_node_ids uuid[]` | New, default `{}`. Cards already drawn in this game. Covered by the existing TIREUR-only policy. |
| `dsa_normalize_settings` | Accepts `timed`; copies `think_seconds`/`play_seconds` (when timed) and `max_redraws` (always) from `app_settings`. Any other client key is still `DSA_INVALID_SETTINGS`. Becomes `stable` instead of `immutable` (it reads a table now). |
| `dsa_new_session` | **Only `AI_TIREUR` is ready at creation.** LOCAL and AI_DECOUVREUR now start in the preparation phase like a room. |
| `dsa_start_play` | Starts the clock of a timed game: the thinking time when a human Tireur has the card (in a room, exactly when both players are present), or the game time at once for the AI Tireur. |
| `dsa_end_thinking(session, at, reason)`, `dsa_tick(session)`, `dsa_assert_time(session)` | **New, internal.** The clock. `dsa_tick` ends the thinking phase at its own deadline and then calls time; `dsa_assert_time` raises `DSA_TIME_UP`. |
| `dsa_assert_tireur_ready` | Generalized: every mode but `AI_TIREUR`. |
| `dsa_state_json` | Adds `timed`, `phase`, `think_ends_at`, `play_ends_at`, **`server_now`**, `redraws_used`, `redraws_left`. |
| `dsa_solution_path(graph_id, secret)` | **New, internal.** The book's own path to a name. |
| `dsa_get_solution_path(p_session_id)` | **New RPC**, players, only after `DISCOVERED`/`TIME_UP`/`ABANDONED` (`DSA_GAME_NOT_OVER` otherwise). |
| `dsa_redraw_secret(p_session_id)` | **New RPC**, TIREUR, preparation phase only. `DSA_GAME_STARTED`, `DSA_NO_REDRAW_LEFT`. |
| `dsa_check_time(p_session_id)` | **New RPC**, players. Records `TIME_UP`; never raises it. |
| `dsa_timer_defaults()` | **New RPC**, any player. The durations the setup screen quotes (deviation 3). |
| `dsa_get_my_secret` | Refused with `DSA_WAITING_FOR_PLAYER` while a room is still `WAITING` (S6 open question 2). |
| `dsa_get_revealed_path` | `TIME_UP` counts as an end; `stats` gains `timed`, `play_seconds`, `found_in_seconds`. |
| Every mutating RPC | Ticks the clock and checks `DSA_TIME_UP` **first**. `dsa_ask`/`dsa_guess`/`dsa_ai_decouvreur_step` also check the preparation phase in every mode. |
| `dsa_rematch` | Accepts a `TIME_UP` session as finished; carries over `input_mode` and `timed`. |
| Error codes | New: `DSA_TIME_UP`, `DSA_GAME_STARTED`, `DSA_NO_REDRAW_LEFT`. All three have French lines in the app. |

---

## 2. Verification output

### SQL (no Docker)

Tools in the session scratchpad, never in the repo: `libpg-query` 17.7.4 and `@electric-sql/pglite` 0.5.8 with `uuid_ossp`. The Supabase shim is S2's: the three roles, `auth.users` and `auth.uid()` reading `request.jwt.claims`, `extensions`, Supabase's default grants on `public`, and an empty `supabase_realtime` publication. The "pre-S9" files are the committed `00` and `90` taken from git.

```
== syntax (libpg-query 17.7.4)
OK   migrations/0009_timer.sql  85 statements (26 functions)
OK   sql-editor/06_timer.sql  85 statements (26 functions)
OK   sql-editor/00_all_migrations.sql  358 statements (94 functions)
OK   sql-editor/90_tests.sql  55 statements (18 functions)
     (0001–0008, 01, 02, 03, 04, 05 and 94 all parse too)

== fresh project: 00 → 01 → 90 (each twice), 04 → 94, 06 again → 90
OK   00_all_migrations.sql (run 1)
OK   00_all_migrations.sql (run 2)
OK   01_seed_mini_graph.sql (run 1)  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   01_seed_mini_graph.sql (run 2)  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   90_tests.sql (run 1)  [{"result":"ALL DSA TESTS PASSED"}]
OK   90_tests.sql (run 2)  [{"result":"ALL DSA TESTS PASSED"}]
OK   04_voice.sql
OK   94_voice_tests.sql  [{"result":"ALL DSA VOICE TESTS PASSED"}]
OK   06_timer.sql (on a new 00: no-op)
OK   90_tests.sql (after 06 again)  [{"result":"ALL DSA TESTS PASSED"}]

== owner's upgrade: 00(pre-S9) → 01 → 04 → 90(pre-S9) → games in play → 06 ×2 → 90 ×2 → 00(new) → 90 → 94
OK   00_all_migrations.sql (pre-S9 copy)
OK   01_seed_mini_graph.sql  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   04_voice.sql
OK   90_tests.sql (pre-S9 copy)  [{"result":"ALL DSA TESTS PASSED"}]
OK   old schema: AI_TIREUR/PLAYING/ready=true · HUMAN_VS_HUMAN/WAITING/ready=false · LOCAL/PLAYING/ready=true
OK   06_timer.sql (run 1)
OK   06_timer.sql (run 2)
OK   running games keep playing  AI_TIREUR/PLAYING/ready=true · HUMAN_VS_HUMAN/WAITING/ready=false · LOCAL/PLAYING/ready=true
OK   old sessions keep their settings  {"input_mode":"BUTTONS"}
OK   app_settings seeded  {"think_seconds":40,"play_seconds":120,"max_redraws":2}
OK   old secrets get an empty previous_node_ids  (3 rows)
OK   90_tests.sql (run 1)  [{"result":"ALL DSA TESTS PASSED"}]
OK   90_tests.sql (run 2)  [{"result":"ALL DSA TESTS PASSED"}]
OK   00_all_migrations.sql (new, on the upgraded project)
OK   90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]
OK   94_voice_tests.sql  [{"result":"ALL DSA VOICE TESTS PASSED"}]

== the new 90 on a project that skipped 06
ERR (expected) 90_tests.sql
     DSA TEST SETUP: this project predates the timed-games update; run 06_timer.sql (or the new 00_all_migrations.sql) first

== 06 on a project that skipped 05 (rooms)
ERR (expected) 06_timer.sql
     DSA SETUP: this project predates the rooms update; run 05_rooms.sql first, then this file again

== 06 = 0009
identical bodies (06 has a 14-line header)
```

**Games already in progress keep playing.** 0009 only changes how *new* sessions start, and the sessions created before it already have `tireur_ready_at` set (0008 backfilled them), so they are past the preparation phase and unaffected.

**Mutation check.** Fifteen copies of `00`, each broken on purpose; `90` fails on every one:

```
dsa_tick ignores the game deadline
   → DSA TEST FAILED [15 timer: TIME_UP]: expected error DSA_TIME_UP from [select public.dsa_answer(…)], but it succeeded
the thinking time restarts the game clock from the check, not from the deadline
   → DSA TEST FAILED [15 timer: deadlines]: the game time starts at the thinking deadline, not at the check
a running game re-reads app_settings instead of its own snapshot
   → DSA TEST FAILED [15 timer: app_settings]: the running game uses its own play_seconds
the name can still be changed once the game has started
   → DSA TEST FAILED [16 redraw]: expected error DSA_GAME_STARTED …, got DSA_NO_REDRAW_LEFT
a redraw may draw a name that was already drawn
   → DSA TEST FAILED [16 redraw]: expected error DSA_NO_PLAYABLE_SECRET …, but it succeeded
the REDRAW move carries the new card
   → DSA TEST FAILED [16 redraw]: the REDRAW move says only that the name changed
the book path is readable before the end
   → DSA TEST FAILED [17 solution path]: expected error DSA_GAME_NOT_OVER …, but it succeeded
the book path says OUI to every item of a list
   → DSA TEST FAILED [17 solution path]: CAÏN: the book path lands on the card itself
LOCAL skips the preparation phase
   → DSA TEST FAILED [14 rooms: Tireur ready]: expected error DSA_TIREUR_NOT_READY …, but it succeeded
the card can be read before the second player joins
   → DSA TEST FAILED [15 timer: deadlines]: expected error DSA_WAITING_FOR_PLAYER …, but it succeeded
app_settings is writable by any signed-in user
   → DSA TEST FAILED [15 timer: app_settings]: the running game keeps think_seconds: expected '40', got '90'
dsa_check_time is granted to anon        → DSA TEST FAILED [15 timer: TIME_UP]: anon must not execute dsa_check_time
dsa_timer_defaults is granted to anon    → DSA TEST FAILED [15 timer: app_settings]: anon must not execute dsa_timer_defaults
a name change does not restart the thinking time
   → DSA TEST FAILED [16 redraw]: a new name gives a fresh thinking time
the room clock starts at creation, not when both players are there
   → DSA TEST FAILED [15 timer: deadlines]: the room clock must not start before the second player

15/15 mutations caught
```

Two of these were **not** caught on the first attempt, and both pointed at a real hole in my tests rather than at the SQL:

- *"a redraw may draw a name that was already drawn"* passed, because with 13 cards a random repeat is unlikely. Block 16 now un-approves every CHARACTER of `mini` but two, so the one other card is **the** card: the first redraw must give it, and a second must raise `DSA_NO_PLAYABLE_SECRET`. The graph is restored and re-counted afterwards.
- *"the book path says OUI to every item of a list"* passed, because block 17 replayed the path and checked it ended *somewhere* with no prompt. It now checks `dsa_derive_position` lands on **that card**.

### What `90_tests.sql` gained

- **Precondition** for `06`, and a `dsa_test.eq_json` helper (jsonb equality, so no assertion depends on how Postgres orders keys). The existing `settings` and `stats` assertions were rewritten through it, because both objects legitimately grew.
- **`dsa_test.new_session`** ends the preparation phase by default (`p_ready => false` keeps it open) and takes settings, so the scenarios of blocks 1–13 read as before.
- **Block 14** now states the new rule: LOCAL and AI_DECOUVREUR start unready and refuse `dsa_ask`/`dsa_guess`/`dsa_ai_decouvreur_step`; only AI_TIREUR is ready at creation.
- **Block 15 (timer)** — deadlines, `app_settings`, `TIME_UP`:
  - an untimed game has no clock, and `dsa_check_time` never touches it;
  - `think_ends_at = now() + 40 s` at creation; `server_now` is the server's clock;
  - "Je suis prêt" fixes `play_ends_at = now() + 120 s`, and a rewind, a `go_back` and a refused name never move it;
  - the thinking deadline ends the phase **at the deadline**, so the game time is the same length however long nobody looked — with the `TIREUR_READY` move recording `reason = DEADLINE`;
  - a room's clock starts **on the join**, not at creation, and `dsa_get_my_secret` is refused before it;
  - the AI Tireur has no thinking time;
  - `app_settings` bounds (six `23514` checks and the singleton), RLS (a player sees no row and changes nothing; an admin does), and the snapshot: a running game keeps 40/120/2 while a new one takes 90/300/4;
  - a move that arrives too late raises `DSA_TIME_UP` **and records nothing**; `dsa_check_time` is what writes `TIME_UP` (`ended_at` is the deadline itself, `winner` null, exactly one `TIME_UP` move); then every RPC refuses;
  - `found_in_seconds = 72` on a discovered timed game;
  - privileges for `dsa_check_time`, `dsa_timer_defaults`, and the five new internal functions.
- **Block 16 (name changes)** — two changes then `DSA_NO_REDRAW_LEFT`; a fresh thinking time; the three cards all different; **no leak** (no id and no name of any drawn card in the state, and the `REDRAW` move payload is exactly `{"event": "REDRAW"}` with no node); `DSA_GAME_STARTED` after "Je suis prêt" and after the first question, `DSA_GAME_OVER` after abandoning; it works untimed too; in a room only the Tireur (`DSA_WRONG_ROLE`, `DSA_NOT_PLAYER`, `DSA_WAITING_FOR_PLAYER`), and the Découvreur sees the event but still reads 0 secret rows; `max_redraws = 0` turns it off.
- **Block 17 (the book's path)** — for **every one of the 13 playable cards of `mini`**: the path is non-empty, its entries have exactly the seven `path[]` keys, only SPINE steps carry a `target_text`, replaying it in a second game matches every prompt, lands on **that card**, and ends with the `OUI` that opens it; the played path then equals the book path. Plus `DSA_GAME_NOT_OVER` before the end, `DSA_NOT_PLAYER` for an outsider, availability after `ABANDONED` and `TIME_UP`, and both players of a room reading it (with `has_homonyms` on a shared name).

### packages/core

```
$ npm test --workspace packages/core
 Test Files  13 passed (13)
      Tests  188 passed (188)          (170 before)
$ npm run typecheck --workspace packages/core
> tsc --noEmit            (exit 0)
```

- **`src/solution.ts`** — `solutionPath(ix, secretNodeId)`, the mirror of `dsa_solution_path`. `test/solution.test.ts` (7 tests) pins the CAÏN and DAVID paths (with the book's codes, not just OUI/NON), the entry shape, and that **for all 13 playable cards** replaying the path lands on that card and ends on its `OUI`. One test checks the path never names the card on the way — only the clue of the last step.
- **`src/clock.ts`** — the timer as pure functions (`startPlay`, `endThinking`, `restartThinking`, `tick`, `timeLeftMs`, `activeDeadline`), the mirror of `dsa_tick`. `test/clock.test.ts` (11 tests) covers the AI Tireur's missing thinking phase, ending at the deadline vs. early, the deadline being reached exactly, a redraw's fresh thinking time, and that nothing moves `playEndsAt` once set.
- **`src/types.ts`** — `SessionStatus` gains `TIME_UP` (additive).

### apps/mobile

```
$ npm run typecheck --workspace apps/mobile
> tsc --noEmit            (exit 0)

$ npm test --workspace apps/mobile
Test Suites: 21 passed, 21 total
Tests:       207 passed, 207 total       (167 before)
Snapshots:   1 passed
                                         (no console errors, no act() warnings)

$ npx expo-doctor                 20/21 checks passed (see the note at the top)
$ npx expo export -p web --clear
› web bundles (2):
_expo/static/js/web/entry-….js (2.9MB)
_expo/static/js/web/index-….js (45KB)
Exported: dist
```

**What the new mobile tests prove** (all on a fake clock, through the real offline service, which mirrors the server):

- **`timer.test.tsx` (16 tests).**
  - The countdown is measured from `server_now` plus how long ago the state arrived: a phone whose clock is **two days fast** still shows 40 s, 28 s, then 0.
  - It ticks on its own, warns at 30 s then at 10 s, and fires `onExpire` **exactly once** even as it keeps ticking.
  - A timed game: `think_ends_at` at creation, `play_ends_at` at "Je suis prêt"; the thinking ends at its own deadline after 95 s of nobody looking, so the players still get their whole 120 s; a question, a rewind, a `go_back` and a refused name leave the deadline untouched.
  - `TIME_UP` ends the game with no winner, refuses `ask`, `answer`, `guess`, `rewind`, `go_back` and `redrawSecret`, and still reveals the name and the book's path.
  - The AI Tireur starts the game clock at once; an AI Découvreur game times out too.
  - `found_in_seconds` is 72 after 72 s; the admin's 90/300 is what a new game takes.
  - An untimed game has no clock and never times out.
  - `useGame` shows the thinking countdown, then the game countdown, and ends the game **by itself** when nobody moves.
  - The ring renders "1:12" with its label and an accessible "Il reste 1 minute 12 secondes", and renders nothing at all without a clock.
- **`redraw.test.tsx` (10 tests).** Two changes then `NO_REDRAW_LEFT`; three different cards; `GAME_STARTED` after ready and after the first question; `WRONG_ROLE` for a Découvreur; **no name and no id of any drawn card in the state**; a fresh thinking time and never more game time; `maxRedraws: 0` turns it off. On screen: "Changer de nom · 2 restants", the confirmation ("Tu ne trouves pas ce nom dans le livre ?"), "Non, je garde ce nom" changing nothing, the new card arriving **face down** with "1 restant", the button disappearing once the game starts, and the Découvreur's "Le Tireur a changé de nom." with no card on that screen.
- **`result-solution-path.test.tsx` (10 tests).** "Trouvé !", "Temps écoulé" (with its hint and the name still taught) and "Partie arrêtée"; "Trouvé en 1 min 12 s sur 2 min", "1 min", "8 s"; nothing about time when untimed or when nothing was found; the server's statistics. And the book's path after **each** of the three outcomes, identical every time, seven steps long where the players' own path is two, with the exact `path[]` keys — and `GAME_NOT_OVER` while the game is still on.
- **`voice-play.test.tsx` (+2 tests).** A recording still running when the countdown reaches zero is **cancelled, not stopped**: nothing reaches `transcribe`, so a word said after the limit cannot count. The same when `TIME_UP` arrives from the server instead.
- **`supabase-errors.test.ts` (+2 tests).** `p_settings` carries exactly `input_mode` and `timed`; the state's clock fields and `redraws_*` are parsed; `dsa_redraw_secret`, `dsa_check_time`, `dsa_get_solution_path` and `dsa_timer_defaults` are called by those names; and a server that predates `06_timer.sql` still yields a playable untimed state.

**Updated tests.** Every mode with a human Tireur now starts in the preparation phase, so the S3b/S6/S7b suites end it explicitly (`await service.tireurReady(sessionId)`, or a `p_ready`-style flag in the voice harness). Three assertions changed because the rule changed, not because the test was wrong:

- `local-tireur-first`: "a LOCAL game that already started" now means one whose Tireur has said they are ready.
- `voice-calibration`: an AI_DECOUVREUR game opens on `tireur-ready`, not on `tireur-waiting` — which also means the calibration offer now comes **before** the first question in that mode, which is where it belongs (it amends S7b deviation 5).
- `offline-game` / `homonym-description`: the stats object grew, so those assertions became `toMatchObject` / went through a `makeStats` builder.

`rooms-flow`'s "the other player leaves" was **intermittently failing** (1 run in 3) and is now stable over 4 consecutive full runs: its 30 ms grace period raced real wall time on a loaded machine, and the assertion "not before the grace period" could evaluate after it had already elapsed. The grace is now 400 ms with a 500 ms settle. It is a pre-existing S6 race that my extra state update per refresh made easier to hit; the test still asserts exactly what it did.

### apps/admin

```
$ npm test --workspace apps/admin
 Test Files  9 passed (9)
      Tests  93 passed (93)              (87 before)
$ npm run typecheck --workspace apps/admin
> tsc --noEmit            (exit 0)
$ npm run build --workspace apps/admin
✓ Generating static pages (6/6)
Route (app)                                 Size  First Load JS
…
└ ƒ /reglages                            2.86 kB         178 kB
```

`test/settings.test.ts` (6 tests) pins the bounds **as the database's CHECK constraints**, both ends of each range, the rejection of non-integers, every wrong field being named at once (not just the first), the French durations ("2 min", "1 min 12 s"), and the mock repository keeping what it is given while refusing what the database would — and changing nothing on a refused save.

---

## 3. Screenshots — `docs/sessions/reports/S9-screens/`

From the offline web build (`EXPO_PUBLIC_DSA_OFFLINE=1`, graph `mini`) served locally, Playwright with the system Chrome, 390×844 @2×, light theme, reduced motion; the admin page at 1100×800 in mock mode. **0 page errors, 0 console errors.**

| File | State |
|---|---|
| `01-setup-chronometre` | Préparer la partie: "Le temps" → "Jouer avec le chronomètre" ticked, "40 s pour réfléchir, puis 2 min pour trouver" |
| `02-reflexion-changer-de-nom` | "Réfléchis au chemin…", the large ring at 0:38, the card face down, "C'est bon, je suis prêt", "Changer de nom · 2 restants" |
| `03-carte-retournee` | The same, card turned over |
| `04-confirmation-changer-de-nom` | "Tu ne trouves pas ce nom dans le livre ?" with the two answers |
| `05-chronometre-en-partie` | The Découvreur's first question with the ring at 1:59 in the header slot |
| `06-temps-ecoule` | "⏳ Temps écoulé", the name JACQUES with its description, the stats, then "Le chemin du livre pour trouver JACQUES" drawn by `PathGraph` |
| `07-chronometre-ia-tireur` | The same ring in a solo AI-Tireur game, with the conversation and "Voir le chemin" (the players' own path, during play) |
| `08-trouve-en-chemin-du-livre` | "🎉 Trouvé !", ABRAM, **"Trouvé en 8 s sur 2 min"**, the stats, then the book's path — a real game played end to end by the script |
| `09-admin-reglages` | The admin's Réglages page, with the header's new "Réglages" link |

---

## 4. Files

### SQL (`supabase/`) and docs

| File | Change |
|---|---|
| `migrations/0009_timer.sql` | new (§1) |
| `sql-editor/06_timer.sql` | new: the same content with an owner header |
| `sql-editor/00_all_migrations.sql` | regenerated with `build.sh`: **9 migrations** |
| `sql-editor/90_tests.sql` | precondition, `eq_json`/`core_stats`/`settings`/`timer_defaults` helpers, a preparation-aware `new_session`, block 14 updated, blocks 15–17 |
| `sql-editor/README.md` | the `06` upgrade row and the Réglages pointer |
| `DATABASE_SCHEMA.md` | `app_settings`, the new columns and `TIME_UP`, the four new RPCs, the 0009 changes to the existing ones, the state and revealed-path JSON, the new `dsa_get_solution_path` JSON, the internal functions, setup and eight troubleshooting rows |

### Core (`packages/core`, additive)

| File | Change |
|---|---|
| `src/solution.ts` | new: `solutionPath(ix, secretNodeId)` |
| `src/clock.ts` | new: the timer's rules as pure functions |
| `src/types.ts` | `SessionStatus` gains `TIME_UP` |
| `src/index.ts` | exports both new modules |
| `test/solution.test.ts`, `test/clock.test.ts` | new, 18 tests |

### Mobile (`apps/mobile`)

**No new dependency.**

| File | Change |
|---|---|
| `src/services/types.ts` | `GameSettings` gains `timed`, `think_seconds`, `play_seconds`, `max_redraws`; new `ClientSettings` (the two keys a client may send), `TimerDefaults`, `SolutionPath`; `GameState` gains the clock and the redraw counts; `GameStats` gains `timed`, `play_seconds`, `found_in_seconds` |
| `src/services/game-service.ts` | `redrawSecret`, `checkTime`, `getTimerDefaults`, `getSolutionPath` |
| `src/services/supabase-game-service.ts` | the four calls, and parsing that still works against a server without `06` |
| `src/services/offline-game-service.ts` | the whole mirror: an injectable clock, in-memory `app_settings`, the preparation phase, `dsa_tick`/`assert_time`/`assert_tireur_ready`, redraws, the solution path and the new stats |
| `src/state/use-countdown.ts` | new: the countdown against `server_now`, warnings, `onExpire` |
| `src/state/use-game.ts` | the phase is the server's in every mode; `countdown`, `clockPhase`, `canRedraw`, `redrawSecret`, `otherRedrew`; `receivedAt` for the server-clock offset; `checkTime` when the countdown expires |
| `src/state/use-secret.ts` | `reload()`, for the card a redraw replaces |
| `src/components/countdown-ring.tsx` | new: the ring, with the number always written out |
| `src/components/check-card.tsx` | new: the yes/no card of the chronometer choice |
| `src/components/game-header.tsx` | the ring fills the `timer-slot` during play |
| `src/components/result-header.tsx` | "Temps écoulé"; "Trouvé en X sur Y" |
| `src/views/tireur-ready-view.tsx` | the thinking ring, "Changer de nom" with its confirmation and the new card |
| `src/views/decouvreur-waiting-view.tsx` | the same ring, and "Le Tireur a changé de nom" |
| `src/views/game-table.tsx`, `lobby-view.tsx` | the waiting view takes `game`; the lobby shows the chronometer read-only |
| `src/views/voice-play.tsx` | time up closes the microphone at once |
| `app/jouer/index.tsx` | "Le temps" → the checkbox, with the real durations |
| `app/resultat/[sessionId].tsx` | the game card, then the **book's** path; the players' own path is gone from this screen |
| `src/i18n/fr.ts` | the setup, lobby, ready, timer, room and result strings; three new error codes |
| `README.md` | "The chronomètre" and "The end of every game" sections, and the layout |
| `tests/` | 3 new files; `helpers.tsx` gains `makeState`/`makeStats`/`makeSettings`; 12 files updated for the preparation phase and the grown objects |

`app/partie/[sessionId].tsx` needed **no change**: `TIME_UP` is not `PLAYING`, so the existing redirect already sends both devices to the result screen.

### Admin (`apps/admin`)

| File | Change |
|---|---|
| `src/lib/settings-repository.ts` | new: `AppSettings`, the bounds, validation, `formatDuration`, the Supabase and mock repositories |
| `src/lib/settings-browser.ts` | new: the browser repository (mock in mock mode) |
| `src/components/settings-form.tsx` | new: the page itself |
| `src/components/admin-shell.tsx` | new: the admin gate and header, extracted from `graphes/layout.tsx` so `/reglages` is behind the same gate and the header can carry both links (deviation 1) |
| `src/app/reglages/{layout,page}.tsx` | new |
| `src/app/graphes/layout.tsx` | now four lines: `<AdminShell fill>` |
| `test/settings.test.ts` | new, 6 tests |

---

## 5. Deviations and decisions

1. **`graphes/layout.tsx` was rewritten, which is outside "only the new Réglages page and its link".** The brief asks for the page to be *linked from the admin header*, and that header lived inside the graph layout together with the admin gate. Copying both into a second layout would have left two gates to keep in step. They are now one component, `AdminShell`, used by both layouts with a `fill` flag for the editor's full-viewport behaviour; the rendered markup for `/graphes/**` is unchanged apart from the two nav links.

2. **A refused move does not record `TIME_UP`; `dsa_check_time` does.** This is the one place where the spec's "every mutating RPC raises `DSA_TIME_UP`" meets PostgreSQL: a raise aborts the transaction, so anything the same call wrote — including the `TIME_UP` row — is rolled back. Rather than hide that, the design leans on it:
   - a late move raises **and changes nothing**, which is exactly right: the move must not land;
   - `dsa_check_time` never raises, so it is the call that commits the transition, and the other device sees it over Realtime;
   - the app calls it when its own countdown reaches zero, so in practice the game ends on time whether or not anyone is moving.

   `90_tests.sql` block 15 pins both halves of this, and `DATABASE_SCHEMA.md` says it in the RPC notes and the troubleshooting table.

3. **A new RPC the brief didn't ask for: `dsa_timer_defaults()`.** The checkbox must say "40 s pour réfléchir, puis 2 min pour trouver" *using the current durations*, but `app_settings` is admin-only by RLS, so a player cannot read it. The RPC returns just the three numbers to any signed-in player. They are the rules of the game, not a secret — only writing them is restricted. The app falls back to 40/120/2 if the call fails, so a server without `06` still shows a sensible line.

4. **`play_ends_at` is null during the thinking phase**, and set only when the thinking ends. The alternative — precomputing it — would have made "never changed afterwards" false the moment a redraw restarted the thinking time. The state's `phase` tells the client which deadline to show, so nothing is missing.

5. **`found_in_seconds` is measured from `tireur_ready_at`**, which is the start of the game phase in both timed and untimed games. It is therefore filled for an untimed discovery too. That is additive and harmless — the result screen only writes "Trouvé en …" when `timed` is also true — and it means the lead can look at how long untimed games take without another migration.

6. **The preparation phase is now the server's in LOCAL too, and it survives a reload.** S3b kept the LOCAL `TIREUR_READY` step in memory, so reloading mid-card skipped it. Now a reload lands back on "Regarde ta carte" until the Tireur says they are ready — which is the honest behaviour, and the only one that can carry a clock.

7. **`dsa_rematch` copies the durations afresh** from `app_settings` rather than from the finished game. "Keeps the settings" is honoured for the two things the player chose (`input_mode`, `timed`); a rematch is a new game, so it takes the current durations, exactly like any other new game.

8. **The ring never relies on colour alone.** The seconds are always written inside it, and the level only changes its colour and fires a short haptic. Reduced motion is respected by stepping the sweep a whole second at a time, so nothing on screen moves continuously.

9. **`useCountdown` reads the clock through its props on every tick** instead of capturing `Date.now` once. It makes no difference in the app, but a captured reference keeps pointing at the real clock when a test replaces the global one, which made the behaviour untestable.

10. **The calibration offer moved, for AI_DECOUVREUR games.** S7b put it on the Tireur's play view "because they have no ready phase". They have one now, so the offer appears there — before the first question, which is where S7b wanted it in the first place.

11. **`game_secrets.previous_node_ids` is `uuid[]`, not a second table.** It is read and written only inside the redraw, it is covered by the existing TIREUR-only policy without a new one, and its length is the number of changes used.

12. **`dsa_normalize_settings` became `stable`.** It reads `app_settings` now, so `immutable` would have been a lie the planner could act on.

---

## 6. Open questions

1. **Should the thinking time be spent when the Tireur looks at the card, or when the game starts?** Today it starts with the preparation phase, so a Tireur who leaves the phone on the table for 40 s is ready by deadline with no card read. That follows the owner's "the clock starts once both players are present", but the alternative — starting it at the first `dsa_get_my_secret` — would be kinder to a distracted player. One line in `dsa_start_play` either way.

2. **Nothing warns the players that the time is nearly up on the *other* device.** Each phone runs its own countdown against the same server deadline, so they agree; but the Tireur's phone is silent while the Découvreur is thinking. Should the 10 s warning be spoken (TTS) as well as buzzed?

3. **`max_redraws` is per game, not per Tireur.** In a room the Tireur is fixed, so it is the same thing; after a rematch with swapped roles the new Tireur gets a fresh two. That seems right, but it is worth confirming.

4. **The result screen no longer shows the players' path at all**, as the brief asks. It is still reachable during play ("Voir le chemin"), but once the game ends it is gone. Would a "Voir notre chemin" link under the book's path be worth it, or does it dilute the lesson?

5. **`TIME_UP` and the stale-room cleanup.** A timed game that nobody ever opens again stays `PLAYING` until `dsa_cleanup_stale_sessions` closes it as `ABANDONED` after 6 hours, rather than as `TIME_UP`. Harmless (both are ends, and the name is revealed either way), but the history will say "abandoned" for a game that in truth ran out of time. Worth a line in the cleanup if the lead cares.

6. **For the lead, `GRAPH_SPECIFICATION.md` and `GAME_RULES.md`** (neither is mine to edit):
   - §9 should record the two design points that only emerged in the build: `play_ends_at` is null during the thinking phase, and `dsa_check_time` is the call that *records* `TIME_UP` (deviations 2 and 4).
   - §3 should list `dsa_redraw_secret`, `dsa_check_time`, `dsa_get_solution_path`, `dsa_timer_defaults`, the new state fields and `app_settings`.
   - §4 should list `solutionPath` and the `clock.ts` exports, and `SessionStatus` should gain `TIME_UP`.
   - §8's "LOCAL-only `TIREUR_READY`" is now a server phase in every mode with a human Tireur.
   - `docs/sessions/README.md`'s plan table still shows S9 as "▶ ready now" (its SQL order line already ends `… → 06_timer` (S9)).

   **Noted while this session ran:** the lead committed the S10–S12 briefs and `GAME_RULES.md`'s planned "QUESTION ×N goes back N levels" note (backlog B1). It is explicitly *not implemented yet*, so S9 keeps the current rewind behaviour — and the timer treats a rewind like any other move, so B1 will not disturb it.

7. **Real-device checks still needed:** the ring's haptics at 30 s and 10 s, the SVG ring on Android/iOS in Expo Go, and whether 40 s of thinking feels right with the real book (1,209 names) rather than the mini graph.

8. **`apps/mobile/.env`** (gitignored, so no repo risk) still has a comment naming the book's old slug — S7b's open question 7, still open.

---

## 7. Notes for S7c (live voice, WebRTC)

- **The mic and the clock already cooperate.** `DecouvreurVoice` and `TireurVoice` close the microphone the instant `game.countdown.level === 'UP'`, without waiting for the server, and `useVoiceCapture` cancels (never stops) so nothing is transcribed. When the call owns the microphone (S7b's note), the same `enabled` flag must gate the **call recorder** too — put the condition in one place rather than repeating `countdown.level !== 'UP'`.
- **Nothing may listen during the preparation phase**, and it now exists in every mode with a human Tireur. `TireurReadyView` and `DecouvreurWaitingView` mount no voice panel; a WebRTC call may well be *connected* during this phase (both players are present), but it must not be treated as a turn.
- **A call started in the preparation phase outlives a redraw.** `dsa_redraw_secret` changes nothing about the room, the players or the channel — only the card and `think_ends_at`. The `REDRAW` SYSTEM move arrives on the other phone like any other move.
- **Transcription time counts against the game time** (S7b open question 6). With 2 min and ~1 s per turn, a voice game spends a real fraction of its budget on the network. Worth measuring on a phone before S7c adds a call to the same connection.
- **`server_now` is a free clock sync.** Every state carries the server's clock and the app already computes an offset from it; if signalling ever needs the two phones to agree on a moment, that offset is there.

## 8. Notes for S8 (hardening)

- **`previous_node_ids` widens the "deterministic node id" hole a little.** S2's open question 1 still stands, and now a Tireur's own row carries several node ids instead of one. Nothing new reaches a *Découvreur* — the state only ever carries counts — but the opaque-id work should cover this column too.
- **`dsa_check_time` is the one RPC any player can call repeatedly with no state check.** It locks the session row and does almost nothing, but it is a natural target for the abuse limits: a client calls it about once per game, when its countdown expires.
- **`app_settings` is a new admin-write surface.** The bounds are CHECK constraints, so even a compromised admin session cannot set a 10-hour game; but the audit work should record who changed them (`updated_by` is already there and is currently never written — the RLS update does not set it).
- **The timer changes the abuse picture for `dsa_create_session`.** A timed game ends by itself, so a flood of abandoned timed rooms self-closes at `play_ends_at + the cleanup` instead of idling for 6 hours. Cheap win if the cleanup is ever taught to close them as `TIME_UP` (open question 5).
- **Accessibility:** the ring has `accessibilityRole="timer"` and a French `accessibilityLabel` that reads out minutes and seconds, and it announces the last 10 s politely. The colour levels are never the only signal. Worth a pass with TalkBack/VoiceOver during S8's accessibility work.
- **`90_tests.sql` is now 17 blocks and takes noticeably longer** (block 17 plays 26 games). If it ever becomes tiresome in the dashboard, the per-card loop is the part to sample rather than the part to delete.
