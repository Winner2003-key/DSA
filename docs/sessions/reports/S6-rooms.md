# Report S6 — Rooms: two players on two devices

**Status: done.** Everything in the brief is built and tested, and it was verified live on the owner's hosted Supabase project:
- **SQL:** `0008_rooms.sql`, the paste-ready `05_rooms.sql`, the regenerated `00_all_migrations.sql` (now 0001–0008) and a new block 14 in `90_tests.sql`. Checked with `libpg-query` and PGlite on a fresh project and on the owner's upgrade path, plus 6 mutation checks.
- **App:** "Jouer avec un ami", the lobby (code, Partager, QR code, seats with live presence), joining by code, link or QR, the Tireur-ready phase across devices, Realtime sync with a polling fallback, the connection and other-player banners, the result on both phones, and "Rejouer" with "Mêmes rôles" / "Inverser les rôles".

**Test results:**
- mobile: 135 tests (62 before), typecheck clean;
- core: 170 tests, unchanged; voice: 158 tests, unchanged;
- `expo-doctor`: 21/21;
- the web export succeeds.

**Two-browser test on the hosted project:** it ran with the owner's agreement, after the owner pasted `05_rooms.sql` and got `ALL DSA TESTS PASSED` from `90`. All 11 steps pass. It also found a real bug (lobby cancel opened the result screen), which is fixed and re-verified.

**Not verified:** Expo Go on real phones (no device here). The manual checklist in §4 covers it. Nothing was committed.

> While this session ran, **another session changed `apps/admin/` and `docs/sessions/`** (S5 admin files and reports). I didn't touch any of it. My `package-lock.json` changes are only the two new mobile dependencies and what they pull in.

---

## 1. The SQL file to paste

**The owner already ran it during this session**, for the two-browser test. For any other project that already has `00` and `01`, which is the usual case:

1. SQL Editor → New query → paste **all** of **`supabase/sql-editor/05_rooms.sql`** → **Run**. Expect `Success. No rows returned`.
   - It needs `03_game_ux.sql`. Without it, it stops with `DSA SETUP: this project predates the game UX update; run 03_game_ux.sql first, then this file again`.
   - It is safe to run twice.
2. Paste **all** of **`supabase/sql-editor/90_tests.sql`** → **Run**. Expect one row: **`ALL DSA TESTS PASSED`**.
   - The new `90` refuses to run on a project without `05`: `DSA TEST SETUP: this project predates the rooms update; run 05_rooms.sql (or the new 00_all_migrations.sql) first`.

A **new** project runs `00 → 01 → 90` as before; the regenerated `00` already contains `0006`, `0007` and `0008`.

**Optional:** an hourly stale-room cleanup with pg_cron.
1. Dashboard → **Integrations → Cron** → enable it.
2. **Create job**: name `dsa-cleanup-stale-sessions`, schedule `17 * * * *`, SQL snippet `select public.dsa_cleanup_stale_sessions();`.

The details are in `DATABASE_SCHEMA.md` "Stale rooms (0008)". The app doesn't need it: the cleanup already runs whenever someone creates, joins or replays a room.

### What changes on the server

| Object | Change |
|---|---|
| `game_sessions.tireur_ready_at timestamptz` | New. Set at creation for every mode except HUMAN_VS_HUMAN. **On the first run of `05` only**, it is backfilled for every session that isn't `WAITING`, so rooms already being played keep going (checked, §2). |
| `game_sessions.rematch_of uuid → game_sessions` | New (on delete set null), plus a partial index. |
| `game_sessions_open_updated_at_idx` | Partial index on `updated_at` for open sessions (cleanup). |
| `dsa_tireur_ready(p_session_id)` | **New RPC**, TIREUR only. Sets `tireur_ready_at` once and records a `SYSTEM` move `TIREUR_READY`; a second call changes nothing. It needs both players (`DSA_WAITING_FOR_PLAYER` otherwise). A no-op in other modes. |
| `dsa_ask`, `dsa_guess` | `DSA_TIREUR_NOT_READY` in a PLAYING HUMAN_VS_HUMAN room until the Tireur is ready. `DSA_GAME_OVER` is checked first. |
| `dsa_state_json` (so `dsa_get_state` and every mutating RPC) | Adds `tireur_ready` (boolean) and `room_code`. |
| `dsa_cleanup_stale_sessions(p_idle interval default '6 hours')` | **New, internal** (not granted to clients). Closes open sessions whose `updated_at` is older than `p_idle` as `ABANDONED`, with a `SYSTEM` move `{"event":"ABANDONED","reason":"IDLE"}`. Finished sessions are never touched. At most 500 per call, `skip locked`, and the idle time must be ≥ 1 minute (`DSA_INVALID_IDLE`). |
| `dsa_create_session`, `dsa_join_session` | Same signatures; they run the cleanup first. Creation now goes through the internal `dsa_new_session`. |
| `dsa_rematch(p_session_id, p_swap_roles default false)` | **New RPC** (see deviation 1). Returns `(session_id, room_code, role)`. |
| Internal functions | `dsa_new_session`, `dsa_assert_tireur_ready`: EXECUTE revoked from `anon` and `authenticated`, and tested. |
| Error codes | New: `DSA_TIREUR_NOT_READY`, `DSA_WAITING_FOR_PLAYER`, `DSA_GAME_NOT_OVER`, and `DSA_INVALID_IDLE` (internal). The first three have French lines in the app. |

## 2. Verification output

### SQL (no Docker)

The tools were installed in the session scratchpad, not the repo: `libpg-query` 17.7.4 and `@electric-sql/pglite` 0.5.8 with `uuid_ossp`. The Supabase shim follows S2:
- the roles `anon`, `authenticated` and `service_role`;
- `auth.users` and `auth.uid()` reading `request.jwt.claims`;
- `extensions`;
- Supabase's default grants on `public`;
- an empty `supabase_realtime` publication.

The "pre-S6" files are copies of `00`, `90` and `04` saved before any edit.

```
== syntax (libpg-query 17.7.4)
OK   migrations/0008_rooms.sql  31 statements (10 functions)
OK   sql-editor/00_all_migrations.sql  273 statements (68 functions)
OK   sql-editor/05_rooms.sql  31 statements (10 functions)
OK   sql-editor/90_tests.sql  46 statements (14 functions)
     (every other migration and sql-editor file also parses: 0001–0007, 01, 02, 03, 04, 94)

== fresh project: 00 → 01 → 90 (each twice), 04 → 94, 05 again → 90
OK   00_all_migrations.sql (run 1)
OK   00_all_migrations.sql (run 2)
OK   01_seed_mini_graph.sql (run 1)  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   01_seed_mini_graph.sql (run 2)  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   90_tests.sql (run 1)  [{"result":"ALL DSA TESTS PASSED"}]
OK   90_tests.sql (run 2)  [{"result":"ALL DSA TESTS PASSED"}]
OK   04_voice.sql
OK   94_voice_tests.sql  [{"result":"ALL DSA VOICE TESTS PASSED"}]
OK   05_rooms.sql (on a new 00: no-op)
OK   90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]

== owner's upgrade: 00 (pre-S6) → 01 → 04 → 90 (pre-S6) → rooms in play → 05 ×2 → backfill check → 90 ×2 → 00 (new) → 90 → 94
OK   00_all_migrations.sql (pre-S6 copy)
OK   01_seed_mini_graph.sql  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   04_voice.sql
OK   90_tests.sql (pre-S6 copy)  [{"result":"ALL DSA TESTS PASSED"}]
OK   old schema: one room PLAYING, one WAITING
OK   05_rooms.sql (run 1)
OK   05_rooms.sql (run 2)
OK   backfill check  [{"result":"backfill ok"}]      ← the PLAYING room is ready and keeps playing; the WAITING one is not ready
OK   90_tests.sql (run 1)  [{"result":"ALL DSA TESTS PASSED"}]
OK   90_tests.sql (run 2)  [{"result":"ALL DSA TESTS PASSED"}]
OK   00_all_migrations.sql (new, on the upgraded project)
OK   90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]
OK   94_voice_tests.sql  [{"result":"ALL DSA VOICE TESTS PASSED"}]

== new 90 on a project that skipped 05
ERR (expected) 90_tests.sql
     DSA TEST SETUP: this project predates the rooms update; run 05_rooms.sql (or the new 00_all_migrations.sql) first

== 05 on a project that skipped 03 (0001–0005 only)
ERR (expected) 05_rooms.sql
     DSA SETUP: this project predates the game UX update; run 03_game_ux.sql first, then this file again

== 05 = 0008
identical bodies (05 has a 14-line header)
```

**Mutation check.** Six copies of `00`, each broken on purpose; `90` fails on every one:

```
dsa_ask skips the ready check        → DSA TEST FAILED [14 rooms: Tireur ready]: expected error DSA_TIREUR_NOT_READY from [select public.dsa_ask('…')], but it succeeded
cleanup also closes finished games   → DSA TEST FAILED [14 rooms: stale cleanup]: finished DISCOVERED untouched: expected 'DISCOVERED/DECOUVREUR', got 'ABANDONED/DECOUVREUR'
state says tireur_ready = true always→ DSA TEST FAILED [12 security]: tireur_ready before "Je suis prêt": expected 'false', got 'true'
cleanup granted to authenticated     → DSA TEST FAILED [14 rooms: stale cleanup]: authenticated must not execute dsa_cleanup_stale_sessions
rematch ignores p_swap_roles         → DSA TEST FAILED [14 rooms: rematch]: proposer takes the other role: expected 'DECOUVREUR', got 'TIREUR'
join does not clean up first         → DSA TEST FAILED [14 rooms: stale cleanup]: expected error DSA_ROOM_NOT_FOUND from [select public.dsa_join_session('DSA-4510')], but it succeeded
```

On the first try, the "granted to authenticated" mutation was **not** caught: the call still failed with 42501, but only because of the table privileges. I added explicit `has_function_privilege` checks, and it is caught now.

**What `90_tests.sql` gained:**
- **Precondition** for `05`.
- **Block 12 (security)**, which now has to call `dsa_tireur_ready` before its loop:
  - `tireur_ready` is `false` for the Découvreur before the Tireur is ready, and the state holds neither the secret's node id nor its name;
  - `dsa_tireur_ready` doesn't leak the name.
- **Block 14, Tireur ready:**
  - `room_code` and `tireur_ready` are in the state;
  - WAITING → `DSA_WAITING_FOR_PLAYER`;
  - after the join, the Découvreur's state has no id, name or clue of the secret;
  - `dsa_ask` and `dsa_guess` → `DSA_TIREUR_NOT_READY`; the Découvreur → `DSA_WRONG_ROLE`; an outsider → `DSA_NOT_PLAYER`;
  - ready twice leaves exactly one `TIREUR_READY` move; ask and guess then work;
  - `DSA_GAME_OVER` after abandoning;
  - LOCAL, AI_TIREUR and AI_DECOUVREUR are ready at creation and play at once;
  - EXECUTE privileges are as expected.
- **Block 14, stale cleanup:**
  - five sessions: idle WAITING, idle PLAYING, active WAITING, DISCOVERED long ago, ABANDONED long ago;
  - `authenticated` and `anon` can't execute it (42501 and `has_function_privilege`); `DSA_INVALID_IDLE`;
  - `8 hours` closes nothing;
  - the default closes only the two idle open sessions (with `ended_at` and the `IDLE` moves); the finished ones keep their status, `winner` and old `ended_at`, and get no move;
  - a player of a closed room reads `ABANDONED` and gets `DSA_GAME_OVER`;
  - **a joiner after cleanup gets `DSA_ROOM_NOT_FOUND`**, and nobody joined;
  - `dsa_create_session` closes idle rooms.
- **Block 14, rematch:**
  - `DSA_GAME_NOT_OVER`; an outsider → `DSA_NOT_PLAYER`;
  - the swap gives the proposer the other role; the new room is WAITING with the same settings (`VOICE`), the display names kept and `rematch_of` set;
  - a second call returns the same room and role;
  - the other player joins the same room with the free role; the game starts with `tireur_ready = false`, and the new Tireur can read the new card;
  - an outsider gets `DSA_ROOM_FULL`; an AI room → `DSA_WRONG_MODE`; privileges checked.

### apps/mobile

```
$ npm run typecheck --workspace apps/mobile
> tsc --noEmit
exit 0

$ npm test --workspace apps/mobile
PASS tests/supabase-errors.test.ts
PASS tests/room-phase.test.ts
PASS tests/path-layout.test.ts
PASS tests/rematch.test.ts
PASS tests/realtime-sync.test.ts
PASS tests/room-code.test.ts
PASS tests/offline-game.test.tsx
PASS tests/use-game-realtime.test.tsx
PASS tests/homonym-description.test.tsx
PASS tests/question-phrasing.test.tsx
PASS tests/decouvreur-never-sees-the-secret.test.tsx
PASS tests/local-tireur-first.test.tsx
PASS tests/decouvreur-conversation.test.tsx
PASS tests/rooms-flow.test.tsx
Test Suites: 14 passed, 14 total
Tests:       135 passed, 135 total          (no console errors, no act() warnings)

$ npx expo-doctor
21/21 checks passed. No issues detected!

$ npx expo export -p web --clear
› web bundles (2):
_expo/static/js/web/entry-….js (2.8MB)
_expo/static/js/web/index-….js (45KB)      ← barcode-detector, loaded only by the web QR scanner
Exported: dist

$ npm test --workspace packages/core     →  Test Files 11 passed (11) · Tests 170 passed (170)   (unchanged)
$ npm test --workspace packages/voice    →  Test Files 7 passed (7) · Tests 158 passed (158)      (unchanged)
```

**What the new mobile tests prove:**
- **`room-code.test.ts` (32 tests): formatting and parsing.**
  - `DSA-1234`, `dsa-1234`, `dsa1234`, `DSA 1234`, `1234` and `0042` are accepted.
  - So are join links: `dsa://rejoindre/…`, `https://…/rejoindre/…?utm#`, URL-encoded, and Expo Go's `exp://ip:port/--/rejoindre/…`.
  - Rejected: 3 or 5 digits, letters, `ABC-`, `DSA--`, other paths, a bare `exp://` address, an empty link.
  - While typing: the prefix appears at the first digit, digits are capped at 4, `dsa`/`dsa-` stay empty, backspacing works, and a pasted link doesn't pick up the digits of its IP address.
  - Links: the web URL is preferred, otherwise the app link; round trips parse back.
- **`realtime-sync.test.ts` (8 tests): subscribe debounce and fallback polling, with a mocked channel and fake timers.**
  - 3 events 40 ms apart make exactly **one** refetch at +150 ms; events far apart make separate refetches.
  - One catch-up read when the channel becomes SUBSCRIBED.
  - Polling runs every 5 s while CONNECTING, stops once SUBSCRIBED, restarts on `CHANNEL_ERROR`/`TIMED_OUT` (status `RECONNECTING`) and stops again after reconnecting.
  - `resubscribe` closes the old channel and ignores its late events; `close` stops everything.
  - `SupabaseGameService.subscribe` uses the channel; the real channel factory binds exactly three `postgres_changes` (`game_sessions id=eq.`, `game_moves` and `game_players game_session_id=eq.`), removes the channel on close, and reports a failed sign-in as `CHANNEL_ERROR`, so polling takes over.
- **`room-phase.test.ts` (9 tests): the lobby state machine.**
  - waiting (the other seat empty); presence `unknown` until the channel is subscribed (no false "Déconnecté");
  - both present; away is not gone; ready → playing;
  - **other player gone** only after the whole grace period, in TIREUR_READY or PLAYING, never in the lobby or after the end;
  - `trackAbsence` (start, keep counting, clear on return);
  - `presenceByRole` (an active phone beats an away one, then the freshest; junk is ignored).
- **`rematch.test.ts` (12 tests): rematch.**
  - "Inverser les rôles" end to end with a fake server and two broadcast endpoints: the proposer becomes Découvreur, the offer parses, and accepting calls `dsa_rematch(old, swap)` and makes the accepter Tireur;
  - "Mêmes rôles"; both pressing "Rejouer" at once land in the same room;
  - a failed broadcast doesn't fail the rematch;
  - "Non merci" reaches the proposer for that rematch only;
  - malformed offers, or offers about another game, are ignored.
- **`rooms-flow.test.tsx` (5 tests): the real `RoomTable`, `useGame` and `useRoom`, with a fake server that pushes and a fake Realtime presence.**
  - **Lobby:** the code digits, the QR code, Partager, "Awa (Toi)" connected, "En attente du Découvreur…", this phone tracking `{role, name, activity}` on `room:DSA-4821`. When the Découvreur joins, the Tireur's phone moves to the card.
  - **Découvreur's phone:** "Le Tireur découvre sa carte…" with `think-timer-slot`, no prompt, no Ask button. After the other phone's `tireurReady`, "ANCIEN ?" appears. The Découvreur's phone **never called `getMySecret`**.
  - **Tireur's phone:** the card turns over; "Je suis prêt" calls `tireurReady`; the phone then waits for the question.
  - **Other player gone:** nothing before the grace period, then "Bill s’est déconnecté.". "Attendre" hides it; "away" shows the soft banner; leaving again brings the banner back; "Abandonner" abandons.
  - **"Connexion perdue… reconnexion":** shown after the channel has been down for the threshold, gone when it is back.
- **`use-game-realtime.test.tsx` (4 tests).**
  - LOCAL and AI games never subscribe.
  - A room subscribes once across LOBBY → TIREUR_READY → PLAYING and unsubscribes when it ends.
  - background → active resubscribes and refetches.
  - A push that arrives while this phone's own action is in flight is read once the action returns.

### The two-browser test, on the owner's hosted project

**Setup:**
- a web build with `EXPO_PUBLIC_DSA_GRAPH_SLUG=mini`, exported to the scratchpad and served locally;
- Playwright (`playwright-core`, installed in the scratchpad) with the system Chrome at 390×844 @2x;
- **two separate browser contexts**, so two anonymous players, "Awa" and "Bill".

It ran after the owner pasted `05` and `90`. The times are what each step took to show up on the other phone (hosted Realtime, from this machine).

```
1. Awa creates a room (Tireur, Boutons)
  room DSA-4412, session 0644dba2-…
  Tireur seat: Tireur | Awa (Toi) | Connecté
  Découvreur seat: Découvreur | En attente du Découvreur…
2. Bill joins by typing the code in lower case without the dash
  field shows: DSA-4412
  Awa sees the card after Bill joined (push): 2828 ms      (includes Bill's sign-in, navigation and join)
  Bill: "Le Tireur découvre sa carte…"
  Bill has an ask button during the ready phase: false
3. Awa turns the card and is ready
  card: JEROBOAM
  Bill gets the first question (push): 792 ms
  Bill's question: ANCIEN ?
4. One exchange across the two phones
  Awa sees the question (push): 1336 ms
  Bill sees the answer (push): 1325 ms
5. Bill closes his tab: presence on Awa's phone
  Awa: "s'est déconnecté" banner (10 s grace): 12511 ms
  "Attendre" hides the banner: true
  Bill reopened the game in a new tab (same anonymous player): state restored
6. Bill loses the network
  "Connexion perdue… reconnexion" shown while offline: true
  banner gone after the network is back: 808 ms
7. Bill calls the name; Awa confirms: both phones go to the result
  Awa sees the name call (push): 1302 ms
  Awa on the result screen: 483 ms
  Bill on the result screen (push): 1166 ms
8. Rematch: Awa chooses "Inverser les rôles", Bill accepts
  Bill sees the offer (broadcast): 208 ms
  offer: Awa veut rejouer | Rôles inversés : tu deviens Tireur. | Non merci | Rejouer
  same new session on both: true (ac38ca69-…)
  roles swapped: Bill sees the card, Awa waits for the Tireur
9. Awa leaves the game: both phones end ABANDONED
  Bill sent to the result (push): 1188 ms
10. Deep link: Bill creates a room, Awa opens /rejoindre/<code> (name remembered → joins at once)
  joined DSA-7351 from the link; Awa is the Tireur
  Bill left: both ended
11. Cancel in the lobby
  cancelled with the lobby button: back home, no result screen: true
  cancelled with the top bar: back home, no result screen: true
cleanup:
  0644dba2-… DISCOVERED · ac38ca69-… ABANDONED · 81be1a2c-… ABANDONED · c2e2aede-… ABANDONED · 3506cea9-… ABANDONED
sessions touched: 5
page errors / console errors: 1
  bill console: Failed to load resource: net::ERR_INTERNET_DISCONNECTED     ← step 6, deliberately offline
```

**Earlier runs:**
- **Run 1** stopped at step 9 because of a bug in the **script**: web stack screens stay mounted but hidden, and `.first()` clicked a hidden "Retour". The locator was fixed to visible elements only.
- **Run 2** stopped at step 11 because of a real **app bug**. Cancelling in the lobby abandoned the room, then the "game over" redirect beat the "go home" navigation and opened the result screen, revealing a card nobody had played. It is fixed (deviation 12) and passed in run 3 above.

**What was written to the owner's project:**
- **11 sessions** across the 3 runs, all `DISCOVERED` or `ABANDONED`. The script abandons, as its own player, any session a failed run left open; run 1's open rematch was cleaned up that way.
- **8 anonymous users** in `auth.users`: 2 per run, plus 2 from the probe that checked whether `05` was installed.

Screenshots from run 3 are in `docs/sessions/reports/S6-screens/`, in the light theme (the headless browser's system setting):

> **The images were deleted on 2026-09-23.** The table below *is* the record. Don't re-capture these screens to find out what they showed — read the words. If you need a picture of something this table doesn't answer, capture only that one screen with `tools/screens/`, write down what it told you, and delete it again.


| File | State |
|---|---|
| 01-awa-lobby | Lobby: "Partie créée", DSA-4412, Partager, QR code, Awa (Toi) Connecté, "En attente du Découvreur…", Façon de jouer : Boutons |
| 02-bill-join-form | Rejoindre une partie: the code typed as "dsa4412" shown as DSA-4412, Scanner le QR code, Ton prénom |
| 03-awa-tireur-ready | The Tireur's card and "C’est bon, je suis prêt" |
| 04-bill-waits-for-tireur | The Découvreur's phone: "Le Tireur découvre sa carte…" |
| 05-bill-first-question | "Première question: ANCIEN ?" |
| 06-awa-question-arrives | "Le Découvreur demande ANCIEN ?" on the Tireur's phone |
| 07-bill-answer-arrives | The answer stamped on the Découvreur's phone |
| 08-awa-other-gone | "Bill s’est déconnecté." with Attendre / Abandonner |
| 09-bill-connection-lost | "Connexion perdue… reconnexion" |
| 10-bill-result | The result on the second phone |
| 11-awa-rematch-choice | "Rejouer ensemble": Mêmes rôles / Inverser les rôles |
| 12-bill-rematch-offer | "Awa veut rejouer · Rôles inversés : tu deviens Tireur." with Non merci / Rejouer |
| 13-bill-now-tireur | After the rematch: Bill has the card |
| 14-awa-lobby-before-cancel | A second lobby just before cancelling |

## 3. Files

### SQL (`supabase/`) and docs

| File | Change |
|---|---|
| `migrations/0008_rooms.sql` | new (§1) |
| `sql-editor/05_rooms.sql` | new: the same content with an owner header |
| `sql-editor/00_all_migrations.sql` | regenerated with `build.sh`: **8 migrations** (0001–0008, including S7a's 0007) |
| `sql-editor/90_tests.sql` | precondition, block 12 ready step, block 14 (three parts) |
| `sql-editor/README.md` | `04` and `05` rows, the pg_cron pointer, "keep each pair identical" (see deviation 17) |
| `DATABASE_SCHEMA.md` | the new columns; `dsa_tireur_ready` and `dsa_rematch`; the 0008 changes to create, join, ask and guess; `tireur_ready`/`room_code` in the state; internal functions; "Stale rooms (0008)" with the optional pg_cron steps; the room channel (presence, `rematch`/`rematch_declined`, S7c signaling) and the app's game subscription; setup and troubleshooting rows |

### apps/mobile

**Dependencies** (`npx expo install`, both work in Expo Go): `expo-camera` ~57.0.5 (QR scanning on native and web) and `react-native-qrcode-svg` ^6.3.24 (uses the `react-native-svg` already installed). `app.json` gets the `expo-camera` plugin with a French camera permission text only (see deviation 14), and `locales/fr.json` gets `NSCameraUsageDescription`.

**Services:**

| File | Change |
|---|---|
| `src/services/realtime-sync.ts` | new: `createGameSubscription` (150 ms debounce, 5 s polling only while not subscribed, catch-up read on subscribe, `resubscribe`, `close`), with an injectable channel and timers |
| `src/services/supabase-game-service.ts` | `supportsRealtime = true`; `subscribe`; `supabaseGameChannel` (the three `postgres_changes`, one topic per subscription); `tireurReady`; `rematch`; parses `tireur_ready` (true when absent, so a server without `05` still plays) and `room_code` |
| `src/services/supabase.ts` | `ensureRealtimeAuth()`: sign in, then `realtime.setAuth()` before any channel |
| `game-service.ts`, `types.ts`, `index.ts` | `tireurReady`, `rematch`, `subscribe(…, onStatus)`, `GameState.tireur_ready` and `room_code`, `RematchSession`, `RealtimeStatus` |
| `offline-game-service.ts` | always ready; `room_code`; `rematch` → `WRONG_MODE` (rooms need the server) |

**State:**

| File | Change |
|---|---|
| `src/state/use-game.ts` | **`phase: LOBBY \| TIREUR_READY \| PLAYING \| ENDED`** replaces `localPhase`: LOCAL keeps its client step, rooms use the server's `tireur_ready`. `confirmTireurReady` is client-side in LOCAL and calls `dsa_tireur_ready` in a room. It subscribes only while a room is open; AppState foreground → resubscribe + refetch; `realtimeStatus`; `connectionLost` (channel down ≥ 4 s, or a background refresh failed with `NETWORK`); a push during an action is refetched afterwards; out-of-order responses are dropped. |

**Rooms (`src/rooms/`, new):**

| File | Contents |
|---|---|
| `room-code.ts` | `parseRoomCode`, `formatRoomCodeInput`, `isCompleteRoomCode`, `roomJoinPath`, `roomJoinUrl` |
| `room-channel.ts` | `room:<code>` manager: one shared channel per code, reference-counted, with a 2 s release grace; presence `{role, name, activity, at}` re-tracked on every (re)join; broadcast events list `ROOM_BROADCAST_EVENTS`; `presenceByRole` |
| `use-room.ts` | `useRoom(code, me, {onBroadcast})`: presence, status, `send`, the handle; AppState → `away`; `joinUrlFor(code)` |
| `room-phase.ts` | `roomPhaseOf`, `describeRoom` (seats, `bothPresent`, `otherGone`), `trackAbsence`, `OTHER_GONE_GRACE_MS` = 10 s |
| `rematch.ts` | `proposeRematch`, `acceptRematch`, `declineRematch`, payload parse and build, `roleOnAccept` |
| `player-name.ts` | the remembered player name (AsyncStorage, 24 characters) |
| `share.ts` | the RN `Share` sheet; on the web `navigator.share`, or the clipboard ("Lien copié") |
| `index.ts` | exports |

**Views and components:**

| File | Change |
|---|---|
| `src/views/room-table.tsx` | new: lobby or table, the "Connexion perdue", "X s’est déconnecté" (Attendre / Abandonner) and "absent un instant" banners, and the rematch refusal from the old room |
| `src/views/lobby-view.tsx` | new |
| `src/views/decouvreur-waiting-view.tsx` | new: "Le Tireur découvre sa carte…" + `think-timer-slot` |
| `src/views/join-view.tsx` | new: code field, scan button (hidden on a web browser without a camera), name, auto-join from a link when the name is known |
| `src/views/tireur-ready-view.tsx` | room hint, `think-timer-slot`, disabled while busy |
| `src/views/game-table.tsx` | TIREUR_READY in a room: the Tireur sees the card, the Découvreur the waiting view |
| `src/components/` | new: `room-code-display`, `room-qr` (always dark on white), `seat-card`, `notice-banner`, `text-field`, `qr-scanner` (expo-camera `CameraView`, permission flow, "Ce QR code n’est pas une partie DSA"); `game-header` uses `phase`; `index` exports |
| `src/i18n/fr.ts` | `friend`, `join`, `lobby`, `room` and `rematch` strings; the three new error codes |

**Screens:**

| File | Change |
|---|---|
| `app/index.tsx` | "Jouer avec un ami" enabled → `/ami` |
| `app/ami/index.tsx` | new: Créer une partie / Rejoindre une partie (disabled in offline mode, with a note) |
| `app/jouer/index.tsx` | `?ami=1`: "Ton rôle" (Tireur / Découvreur), "Ton prénom", Façon de jouer ("Celui qui crée la partie choisit pour les deux joueurs", Voix still "Bientôt") → a HUMAN_VS_HUMAN room |
| `app/rejoindre/index.tsx` | new |
| `app/rejoindre/[code].tsx` | new: `dsa://rejoindre/DSA-1234` and `/rejoindre/DSA-1234` |
| `app/partie/[sessionId].tsx` | rooms use `RoomTable`. ENDED → result on both phones, but a room that ends from the lobby → home. Top bar "Annuler la partie" in the lobby. `?revanche=&ancien=` passes the rematch origin. |
| `app/resultat/[sessionId].tsx` | in a room, stays on `room:<code>`. "Rejouer" opens "Rejouer ensemble" (Mêmes rôles / Inverser les rôles / Nouvelle partie seul). An incoming offer shows "X veut rejouer" with Non merci / Rejouer. |

**Config, docs and tests:**

| File | Change |
|---|---|
| `.env.example` | optional `EXPO_PUBLIC_DSA_WEB_URL` |
| `README.md` | the rooms section, the variable, the layout |
| `jest.setup.ts` | `expo-camera` mock |
| `tests/` | 6 new files (§2); `decouvreur-never-sees-the-secret` and `supabase-errors` updated for the new service methods, state fields and codes |

## 4. Manual checklist for the owner

**Before you start:**
- `05_rooms.sql` has been run (done this session).
- Anonymous sign-ins are on.
- For a quick test, set `EXPO_PUBLIC_DSA_GRAPH_SLUG=mini` in `apps/mobile/.env`, then `cd apps/mobile && npx expo start --clear`.
- Optional: set `EXPO_PUBLIC_DSA_WEB_URL` to the Vercel address, so the phone camera app opens QR codes in the browser.

### A. Two phones with Expo Go (same Wi-Fi, or `npx expo start --tunnel`)

1. **Phone A:** Accueil → **Jouer avec un ami** → **Créer une partie** → "Je suis le Tireur", type a name → **Créer la partie**.
   - [ ] The lobby shows DSA-#### large, Partager, a QR code, your seat "(Toi) · Connecté" and "En attente du Découvreur…".
2. **Phone A:** **Partager**.
   - [ ] The system share sheet opens with "Rejoins ma partie de DSA ! Code : DSA-#### …" and a link.
3. **Phone B:** Accueil → Jouer avec un ami → **Rejoindre une partie** → **Scanner le QR code**.
   - [ ] Camera permission is asked in French.
   - [ ] Scanning A's QR code joins at once, or after you type a name if none was remembered.
   - Also try typing the code as `dsa1234` or `1234`.
4. **Phone A:**
   - [ ] Within ~2 s the lobby becomes "Regarde ta carte".
5. **Phone B:**
   - [ ] "Le Tireur découvre sa carte…", with no question and no buttons.
6. **Phone A:** turn the card over → **C’est bon, je suis prêt**.
   - [ ] Phone B shows "Première question : ANCIEN ?" within ~1–2 s.
7. **Play a few turns:**
   - [ ] Each question and answer appears on the other phone within ~1–2 s.
   - [ ] "QUESTION ×1" on A and "Revenir à une question" on B work across phones.
8. **Background:** put B in the background for ~5 s, then bring it back.
   - [ ] A shows "Bill a quitté l’application un instant." while B is away, if the OS keeps the socket.
   - [ ] B catches up at once when it returns.
9. **Lock B** or swipe the app away for ~20 s.
   - [ ] A shows "… s’est déconnecté." with **Attendre** / **Abandonner**.
   - [ ] **Attendre** hides it.
   - [ ] Reopening the game on B (Expo Go keeps the anonymous player) brings the room back.
10. **Airplane mode on B** for ~30 s.
    - [ ] B shows "Connexion perdue… reconnexion".
    - [ ] Airplane mode off: the banner disappears and the game is up to date.
11. **B:** Proposer un nom → the card's name; **A:** "C’est le nom".
    - [ ] Both phones show the result with the path graph.
12. **A:** Rejouer → **Inverser les rôles**.
    - [ ] A shows a new lobby.
    - [ ] B shows "… veut rejouer · Rôles inversés : tu deviens Tireur."
    - B → **Rejouer**:
      - [ ] B now has the card.
      - [ ] A waits for the Tireur.
13. **A:** top bar **Quitter la partie**.
    - [ ] Both phones reach "Partie abandonnée".
14. **Rejouer again**, this time **Non merci** on the other phone.
    - [ ] The proposer's lobby shows "… ne veut pas rejouer."
    - Cancel it with **Annuler la partie**:
      - [ ] Back home, no result screen.
15. **System camera scan** (camera app, not Expo Go's scanner):
    - [ ] It offers to open the link (the web address if `EXPO_PUBLIC_DSA_WEB_URL` is set, otherwise the `exp://` dev link).

### B. Phone + web

1. **Web** (`npx expo start --web`, or the Vercel build once `05` is on its project): create a room as **Découvreur**.
2. **Phone:** Rejoindre → scan the QR code shown in the browser, or type the code.
   - [ ] The phone becomes the Tireur; the browser shows "Le Tireur découvre sa carte…".
3. **Web:** **Partager**.
   - [ ] Chrome desktop copies the message ("Lien copié…"); a mobile browser opens its share sheet.
4. **Web:** open `…/rejoindre/DSA-####` of a new room in a second browser profile.
   - [ ] It joins from the link.
5. **Web:** reload the browser tab mid-game.
   - [ ] The game resumes; presence comes back within a few seconds.
6. **Web:** "Scanner le QR code" in a browser with a webcam.
   - [ ] Permission prompt, then the code is read.
   - Without a webcam the button is replaced by a hint.

## 5. Deviations and decisions

1. **`dsa_rematch` is a server RPC. The brief only described the broadcast.**
   - **How it works:** "Rejouer" calls `dsa_rematch(old_session, swap)`, which creates the new room (`rematch_of` = old). The broadcast `rematch` only tells the other phone. Accepting calls `dsa_rematch(old_session, swap)` again, which joins that room.
   - **Security:** the room channel is public, so a message carrying just a room code could be forged by anyone who knows the old code. With the RPC, only a player of the old session reaches the rematch, and the offer is never trusted.
   - **Races:** the old session row is locked, so two players pressing "Rejouer" at once land in the same room (tested in SQL and in the app).
   - **A missed broadcast** (phone locked) is harmless: pressing "Rejouer" on that phone joins the waiting room.
   - **"Non merci"** sends `rematch_declined`; the proposer's new lobby listens on the old room's channel and shows it.
2. **`room_code` is in the state JSON as well as `tireur_ready`.** The lobby needs the code after a reload, and so does the Realtime channel on the joiner's and the result screens. Players can already read it from `game_sessions`.
3. **`dsa_tireur_ready` needs both players (`DSA_WAITING_FOR_PLAYER`).**
   - The card is shown after the Découvreur joins, not in the lobby. That follows the §9 assumption that "the clock starts only when both are present".
   - The joiner never sees the lobby: joining starts the game, unchanged from S2. The creator's lobby turns into the ready phase.
4. **A refused join doesn't keep its cleanup.** `dsa_join_session` runs the cleanup, then raises `DSA_ROOM_NOT_FOUND`, which rolls back the whole call, cleanup included. The joiner still gets `DSA_ROOM_NOT_FOUND` (the brief's requirement, tested). The idle row is closed by the next successful create/join/rematch or by the optional cron job. A plpgsql function can't commit part of its work.
5. **Cleanup details:**
   - Activity is `game_sessions.updated_at`: every transition updates the row, and the trigger sets it.
   - It uses a partial index, handles ≤ 500 rows per call, uses `for update skip locked`, and needs `p_idle ≥ 1 minute`.
   - It records an `IDLE` move so the history shows why the game ended.
   - It also runs inside `dsa_rematch`.
6. **The backfill on the first run of `05`** marks every non-WAITING session as ready. That bumps their `updated_at` once, which only delays their stale cleanup by one idle period. Later runs don't repeat it.
7. **Names.**
   - The brief shows names on the seats but doesn't say where they come from. "Ton prénom" is on the room version of "Préparer la partie" and on "Rejoindre". It is optional, remembered on the device, and carried into rematches by the server.
   - An unnamed player shows as "Joueur".
8. **"Mêmes rôles"** (plural) instead of the brief's "Même rôles", which is correct French.
9. **One Realtime topic per game subscription** (`game:<id>:<n>`, not `game:<id>`). supabase-js hands back an existing channel with the same topic, so resubscribing after the app returns to the foreground would reuse the channel that is still closing.
10. **Presence.**
    - Each device tracks `{role, name, activity, at}`; seats are matched by role.
    - A seat is "unknown" until this phone's room channel is subscribed, so no false "Déconnecté".
    - The "s’est déconnecté" banner waits **10 s** (the grace period), so a reconnect or a quick app switch doesn't flash it.
    - "Absent un instant" (app in the background) is a separate, softer banner.
11. **"Connexion perdue… reconnexion"** appears when the game channel has not been SUBSCRIBED for 4 s, or when a background refresh failed with a network error. Background refreshes (push, poll, foreground) no longer raise the red error banner on every failed poll. A player's own action still does.
12. **Bug fixed after the live test:** a room that ends while its phone is still in the lobby (cancelled there, or closed as stale) goes **home** instead of to the result screen, which would have revealed an unplayed card.
13. **The QR code carries a link, not a bare code.**
    - With the new optional `EXPO_PUBLIC_DSA_WEB_URL` it is `<web>/rejoindre/DSA-####`, which any camera can open.
    - Otherwise it is `Linking.createURL`: `dsa://` in builds, `exp://…/--/` in Expo Go, the origin on the web.
    - The in-app scanner accepts all of these, as well as a bare code.
    - **Expo Go check:** `expo-camera` is part of Expo Go, so the in-app scanner works there. On the web, `CameraView` scans with the browser's `BarcodeDetector` or the bundled `barcode-detector` polyfill.
14. **Camera plugin.** Only `cameraPermission` is set. Setting `microphonePermission: false` would remove the iOS microphone permission that S7b needs.
15. **`useGame.localPhase` is replaced by `phase`**, one name for every mode, so S9 has one place to hook into.
16. **Offline mode:** rooms need the server. "Créer / Rejoindre" are disabled with a note, and the offline service reports every game as ready.
17. **Files at the edge of ownership:**
    - `supabase/sql-editor/README.md` was updated; it is the index of the files I own.
    - `DATABASE_SCHEMA.md`'s header now mentions S7a's 0007.
    - `GRAPH_SPECIFICATION.md` isn't mine (see open question 7).

## 6. Open questions

1. **The room channel is public.**
   - Anyone who knows `DSA-####` can join `room:<code>`: they can appear in presence, send a fake "X veut rejouer" (harmless, since accepting goes through `dsa_rematch`) or a fake "ne veut pas rejouer".
   - For S7c this matters more: WebRTC offers could be injected.
   - **Recommendation for S7c or S8:** Realtime Authorization. Use private channels (`config.private = true`) with RLS policies on `realtime.messages` that allow a topic `room:<code>` only to players of the open session with that code, through a SECURITY DEFINER helper.
2. **Early card reading.** `dsa_get_my_secret` works for the Tireur while the room is still WAITING. The UI doesn't use it, but once §9 adds a thinking time, a Tireur could read the card through the API before the clock starts. S9 should refuse it until the session is PLAYING, or start the clock at the first read.
3. **Idle time.** Is **6 hours** the right default? A room left open overnight is abandoned on the next create or join.
4. **The game header during the ready phase** reads "Le Tireur réfléchit…" on the Découvreur's phone, above "Le Tireur découvre sa carte…". It is consistent, but should it be a dedicated line once the §9 countdown exists?
5. **Background presence on phones.** iOS and Android may drop the socket soon after the app goes to the background. The other phone then sees "s’est déconnecté" (after 10 s) rather than "absent". The banner offers "Attendre", and the game resumes on return. Please confirm on real phones (checklist A.8–A.9) whether the grace period should be longer.
6. **Test users.** The live test left **8 anonymous users** in the owner's `auth.users` (and 11 finished sessions). They can be deleted from Authentication → Users if wanted. S8 may want a periodic cleanup of old anonymous users.
7. **For the lead, `GRAPH_SPECIFICATION.md`:**
   - §3 should list `dsa_tireur_ready`, `dsa_rematch`, `tireur_ready`/`room_code` in the state, and `dsa_cleanup_stale_sessions`.
   - §3 "Realtime" should mention room presence and the `rematch`/`rematch_declined` events.
   - §8's LOCAL-only `TIREUR_READY` now has its server counterpart for rooms.

## 7. Notes for S7b (voice in the app)

- **Input mode in rooms:**
  - The creator picks it on `app/jouer/index.tsx?ami=1`; the same `input-voice` `ChoiceCard` is still `disabled`/"Bientôt".
  - The joiner reads `state.settings.input_mode`, and the lobby shows it read-only (`lobby-input-mode`).
  - When VOICE is enabled, both phones branch on the same server value.
- **Where voice plugs in a room:** the same `TireurView` answer pad and `DecouvreurView` Ask / Propose buttons as solo play. `GameTable` renders only this phone's role. `TireurReadyView` is shown before the first question: don't start listening there.
- **TTS on two phones:** each phone speaks its own view. The Découvreur hears the answer when the push arrives, 1–2 s after the Tireur taps. Stop TTS before recording (S3 note).
- **Permissions:** `app.json` has the `expo-camera` plugin with **only** `cameraPermission`. Add the `expo-audio` plugin for the microphone. Don't set `microphonePermission: false` on the camera plugin.
- **Realtime is already on:** the voice path needs no polling. Every action returns the state, and the other phone gets a push.

## 8. Notes for S7c (live voice, WebRTC)

- **The room channel is already joined** on the partie screen (lobby and game) and on the result screen: `room:<ROOM_CODE>`, through `src/rooms/room-channel.ts`. Don't create a second channel with that topic, because supabase-js returns the same channel object.
- **Adding signaling:**
  1. Add `'offer' | 'answer' | 'ice' | 'hangup'` to `ROOM_BROADCAST_EVENTS`.
  2. Use `const room = useRoom(state.room_code, me, { onBroadcast: (event, payload) => … })` and `room.send('offer', { sdp, to_role, from_role })`.
  - The channel has `broadcast.self = false`, so a phone never receives its own messages.
- **When to call:** `describeRoom(...).bothPresent` (both phones connected, not away) is the natural trigger. `otherGone` means hang up and show the existing banner. Each presence meta carries `role`, so the Tireur can be the caller.
- **Lifetime:** the room is shared and reference-counted, with a 2 s release grace, so it survives the partie → resultat navigation. A call started in the game can continue on the result screen and into a rematch lobby, which listens on the old room too (`rematchOf`).
- **Security:** see open question 1. Put signaling on a **private** channel with Realtime Authorization, or at least ignore messages whose `from_role` isn't the other seat.

## 9. Notes for S9 (timed games)

- **Server:** the thinking phase is `game_sessions.tireur_ready_at IS NULL` in a PLAYING room. Set `think_ends_at` where `dsa_start_play` makes a room PLAYING, and end the phase in `dsa_tireur_ready` or on the deadline. `dsa_assert_tireur_ready` is where `DSA_TIME_UP` fits.
- **Client:** `useGame().phase === 'TIREUR_READY'` for every mode. The countdown goes in the `think-timer-slot` views of `TireurReadyView` and `DecouvreurWaitingView`, and in `GameHeader`'s `timer-slot`.
- **The AI modes and LOCAL** are ready at creation on the server. LOCAL's phase is still the client step.
