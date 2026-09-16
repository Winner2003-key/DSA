# S2 report — Supabase database (SQL for the dashboard SQL Editor)

**Status: done.** Every file parses with the PostgreSQL parser and runs as a single paste on a fresh Supabase-like database. Running each file a second time also succeeds. `90_tests.sql` returns `ALL DSA TESTS PASSED`. The seed matches `packages/core/fixtures/mini-graph.json` field by field.

None of this has been run on the **hosted** dashboard yet (no database was available to me). The owner's first run of `00 → 01 → 90` is that check.

## 1. Files

| File | Purpose |
|---|---|
| `supabase/migrations/0001_graph_schema.sql` | `graphs`, `graph_versions`, `bible_characters`, `graph_nodes`, `graph_edges`, `admin_users`, `import_batches`; CHECKs, FKs, indexes, `updated_at` triggers |
| `supabase/migrations/0002_game_schema.sql` | `game_sessions` (no secret), `game_players`, `game_moves`, `game_messages`, `game_secrets` |
| `supabase/migrations/0003_functions.sql` | helpers, SQL mirror of the §2 rules, AI logic, all §3 RPCs, EXECUTE grants |
| `supabase/migrations/0004_rls.sql` | RLS on all 12 tables, table privileges |
| `supabase/migrations/0005_realtime.sql` | publication (3 game tables, never `game_secrets`), replica identity |
| `supabase/sql-editor/build.sh` | concatenates the migrations into `00_all_migrations.sql` |
| `supabase/sql-editor/00_all_migrations.sql` | generated; committed |
| `supabase/sql-editor/01_seed_mini_graph.sql` | the mini graph, UUID v5, upserts |
| `supabase/sql-editor/02_make_admin.sql` | `REPLACE_WITH_YOUR_EMAIL` → `admin_users` |
| `supabase/sql-editor/90_tests.sql` | one paste, `begin … rollback`, scenarios 1–12 and extras |
| `supabase/sql-editor/README.md` | run order |
| `DATABASE_SCHEMA.md` | tables, RLS, RPCs and JSON shapes, realtime, secret design, dashboard setup, troubleshooting |

## 2. How the SQL was checked (no Docker)

All tools were installed in the session scratchpad, outside the repo.

1. **Syntax:** `libpg-query` 17.7.4 (the real PostgreSQL 17 parser), run on every file.

   | File | Result |
   |---|---|
   | 0001 | OK, 29 statements |
   | 0002 | OK, 16 |
   | 0003 | OK, 113 (48 functions) |
   | 0004 | OK, 45 |
   | 0005 | OK, 4 |
   | 00_all_migrations | OK, 207 |
   | 01_seed_mini_graph | OK, 10 |
   | 02_make_admin | OK, 2 |
   | 90_tests | OK, 40 |

2. **Execution:** `@electric-sql/pglite` 0.5.8, which is real Postgres (18.3) compiled to WASM and run in Node, with no server and no Docker. Before the files, a small shim imitates a fresh Supabase project:
   - roles `anon`, `authenticated`, `service_role` (bypassrls), granted to `postgres`;
   - `auth.users` and `auth.uid()` read from `request.jwt.claims`;
   - `uuid-ossp` in `extensions`;
   - Supabase's default privileges on `public` (ALL to anon/authenticated/service_role), so the explicit revokes are actually exercised;
   - an empty `supabase_realtime` publication.

   Each file ran as one multi-statement query, like the SQL Editor:

   ```
   OK   00_all_migrations.sql   (run 1)
   OK   00_all_migrations.sql   (run 2 — idempotent)
   OK   01_seed_mini_graph.sql  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
   OK   01_seed_mini_graph.sql  (run 2 — idempotent)
   FIXTURE MATCH: seed == packages/core/fixtures/mini-graph.json (graph, 30 nodes, 29 edges, 12 characters)
   OK   90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]
   OK   90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]   (run 2, same database — the rollback leaves nothing)
   ```

3. **Fixture cross-check.** Every graph, node, edge and character field of the seeded database was compared with S1's `mini-graph.json`: ids, keys, types, labels, clues, descriptions, character ids, metadata, order, kinds, labels and source_variants. **0 differences.**

4. **Rules cross-check with S1.** S1's `answerClass` and `normalizeName` (run with tsx) and my `dsa_answer_class` and `dsa_normalize` were given the same 20 answer labels and 9 names: **0 differences**. The first pass found one (`"NONO"`). I changed the SQL to use S1's algorithm (overlapping `NON` count ≥ 2).

5. **Mutation check.** Two rules were broken on purpose in a copy of `00`, and the tests caught both:
   - OUI_REPETE required 3 repetitions → `DSA TEST FAILED [0 answer class]: oui oui: expected 'OUI_REPETE', got 'AUTRE'`;
   - the `game_secrets` policy was opened to every player → `DSA TEST FAILED [12 security]: game_secrets rows visible to the Découvreur: expected '0', got '3'`.

**What PGlite doesn't prove.** In PGlite, `postgres` is a superuser. In hosted Supabase it isn't, but it owns the tables (so RLS doesn't apply to it) and is a member of `authenticated` and `anon`. That membership is what the tests' `set_config('role', …)` switching relies on. PGlite also has no real Realtime server, so only the publication's contents were checked.

## 3. Hand-review checklist

**Ordering**
- [x] 0001 creates `extensions` and `uuid-ossp` before anything uses them. `dsa_set_updated_at` is created before its triggers.
- [x] Graph tables are created before game tables (FKs from game_sessions, game_secrets and game_moves point to graphs, graph_nodes and bible_characters).
- [x] In 0003, `language sql` functions (whose bodies are validated at creation) come after every function or table they reference:
  - `dsa_answer_class` → `dsa_out_edges`;
  - `dsa_derive_position` → `dsa_current_prompt` and `dsa_sync_position`.

  PL/pgSQL bodies are resolved at call time, but they are ordered too.
- [x] 0004 policies come after the helper functions (0003). 0005 comes after the tables.
- [x] `game_messages.user_id default auth.uid()` depends on Supabase Auth, which exists before any migration.
- [x] The seed inserts characters, then nodes (FK `character_id`), then the node description update, then edges.

**Recursion and security**
- [x] Policies only call `dsa_is_admin`, `dsa_is_session_player` and `dsa_player_role`. These are `SECURITY DEFINER`, owned by `postgres` (the table owner, so not subject to RLS), and read `admin_users` / `game_players` directly. No policy queries a table that has a policy calling back into it.
- [x] Every definer function sets `search_path = public, pg_temp` and qualifies tables as `public.`. `auth.uid()` is qualified.
- [x] EXECUTE is revoked from `public, anon, authenticated` on all 31 internal functions, including `dsa_compute_answer`. The test checks this returns 42501.
- [x] The three policy helpers can be executed by `authenticated` (and `service_role`) only. The 14 RPCs are granted to `authenticated` only, and anon gets 42501 (tested).
- [x] `anon` has no table privileges. `authenticated` has no INSERT/UPDATE/DELETE on game tables (defense in depth beyond RLS) and only SELECT/INSERT on messages.
- [x] `game_secrets` is not in the publication, and 0005 actively drops it if present.
- [x] `SELECT … FOR UPDATE` only appears in volatile functions (`dsa_require_player`, the RPCs).
- [x] The recursive CTEs use `UNION` (not `UNION ALL`), so a cyclic graph can't loop forever.

**Idempotency**
- [x] `create schema/extension/table/index if not exists`; `create or replace function`.
- [x] `drop trigger if exists` + `create trigger`; `drop policy if exists` + `create policy`.
- [x] `alter publication … add table` is guarded by `pg_publication_tables`, inside `do $$`. The publication is created only if missing.
- [x] `replica identity full`, `enable row level security`, grants and revokes can all be repeated.
- [x] Constraints are inline and named in `create table if not exists`, so re-runs don't try to add them again.
- [x] The seed upserts on `id` (`on conflict (id) do update`). `02` uses `on conflict do nothing`.
- [x] `90` is `begin … rollback`, and was verified by running it twice on the same database.
- [ ] Changing a column or a function's return type **in a later version** of these files won't apply through `if not exists` / `create or replace`. A future change needs a new migration (`0006_…`) with explicit `alter` / `drop function` statements.

## 4. Deviations from spec §3 (and the brief), with reasons

1. **Room code uniqueness.** `room_code` is `not null`, with a CHECK `^DSA-[0-9]{4}$`, but it is unique only among **open** sessions (a partial unique index on `WAITING/READY/PLAYING`), not globally. With 4 digits there are only 10,000 codes, so a global unique would stop working for good after 10,000 games. `dsa_join_session` only looks at open sessions, and creation retries up to 100 times (`DSA_ROOM_CODE_EXHAUSTED` after that). Every mode gets a code, including LOCAL and AI.
2. **`search_path`** is `public, pg_temp` instead of `public`. Putting `pg_temp` last is the documented safe pattern for SECURITY DEFINER (it stops temp tables from shadowing ours).
3. **Mutating RPCs return the new state** (jsonb, the same shape as `dsa_get_state`): `dsa_ask`, `dsa_answer`, `dsa_guess`, `dsa_confirm_guess`, `dsa_go_back`, `dsa_rewind`, `dsa_ai_decouvreur_step` and `dsa_abandon`. The spec gave no return type, and this saves a round trip.
4. **Error codes added** to the brief's list:
   - `DSA_NOT_AUTHENTICATED`;
   - `DSA_NOT_AWAITING_GUESS_CONFIRM` (same name as the core's `NOT_AWAITING_GUESS_CONFIRM`);
   - `DSA_INVALID_NAME`, `DSA_INVALID_MODE`, `DSA_INVALID_ROLE`;
   - `DSA_GRAPH_NOT_FOUND`, `DSA_GRAPH_INVALID`, `DSA_NO_PLAYABLE_SECRET`;
   - `DSA_ROOM_CODE_EXHAUSTED`;
   - `DSA_WRONG_MODE` (`dsa_ai_decouvreur_step` outside AI_DECOUVREUR).

   A missing session raises `DSA_NOT_PLAYER`, so the error doesn't reveal whether a session exists.
5. **ANSWER moves store the book's canonical label** (for example `"NONONO"` is recorded as `NONONONON`, `"oui oui"` as `OUIOUIOUI`). The spoken text is kept in `payload.spoken_label` and the class in `payload.answer_class`. The revealed path therefore shows the book's codes. The TS engine may store the label as given, which makes no difference to replay (both use `answerClass`).
6. **AI players have a `game_players` row** (`user_id null`, `is_ai true`, `display_name 'IA'`). The spec doesn't mention it; this way `players` in the state always has both roles, and `unique(session, role)` makes AI rooms "full".
7. **State-machine details the spec leaves open:**
   - `dsa_go_back` and `dsa_rewind` are allowed while awaiting QUESTION **or ANSWER**. A question that was asked but not yet answered is dropped (marked `is_undone`).
   - Neither is allowed during GUESS_CONFIRM: the Tireur must confirm first.
   - `dsa_guess` requires `awaiting = QUESTION`.
   - `READY` is never used: a HUMAN_VS_HUMAN room goes from `WAITING` straight to `PLAYING` when the second player joins.
   - `dsa_abandon` leaves `winner` null.
8. **Playability filters.**
   - A QUESTION prompt uses only APPROVED `DECISION` edges, and a CATEGORY/GROUP only APPROVED `HIERARCHY` edges, to APPROVED targets.
   - Edges whose label class is `AUTRE` are not offered as answers.
   - Ties in `order_index` are broken by edge `id`.
9. **Admins can create sessions on DRAFT or inactive graphs**, which is useful for testing imports. Everyone else needs `PUBLISHED` and `is_active`.
10. **`dsa_get_revealed_path` shape**, which the spec didn't specify: `{status, winner, path: [...same as state...], secret: null | {node_id, name, description}}`.
11. **`dsa_player_role` returns `TIREUR`** when the caller holds both roles (LOCAL). So a LOCAL player can read their own `game_secrets` row; the UI is responsible for hiding it on the shared device.
12. **`90_tests.sql` puts its final select after `rollback`.** Success is carried across the rollback by a session-level advisory lock taken in the last block. If any block fails, the lock is never taken and the select prints `DSA TESTS DID NOT COMPLETE`. This works both in the dashboard, which shows the last statement's result, and in psql without `ON_ERROR_STOP`, where a plain select after rollback would otherwise print a false PASS.
13. **Seed values the fixture didn't fix, taken from S1's `mini-graph.json` so both sides are identical:**
    - graph id = v5(`mini`), name `DSA mini`;
    - character id = v5(`mini:character:<first node key>`);
    - ABRAHAM's description = `PÈRE DE LA FOI · LIE A ABRAHAM`;
    - CHARACTER nodes carry the character's description;
    - `metadata.qualifier` on the alias leaves.

## 5. What other sessions need to know

**Every client (S3, S5, S6, S7)**
- Sign in first: `supabase.auth.signInAnonymously()`. RPCs refuse `anon`.
- Table-returning RPCs come back as arrays; use `.single()`:
  - `dsa_create_session` → `{session_id, room_code}`;
  - `dsa_join_session` → `{session_id, role}`;
  - `dsa_get_my_secret` → `{node_id, name, description}`.
- Errors: `error.message` starts with `DSA_<CODE>:`.

**State JSON** (`dsa_get_state` and every mutating RPC):

```json
{ "status": "PLAYING", "mode": "LOCAL", "awaiting": "QUESTION",
  "prompt": { "node_id": "uuid", "text": "PENTATEUQUE", "node_type": "QUESTION", "answer_classes": ["OUI","NON","NON_REPETE"] },
  "dead_end": false, "pending_guess": null,
  "path": [ { "step_index": 0, "node_id": "uuid", "text": "ANCIEN", "answer_label": "OUI" } ],
  "players": [ { "role": "TIREUR", "display_name": "IA", "is_ai": true, "is_me": false } ] }
```

- `prompt` is `null` when not playing, at a dead end (`dead_end: true`, so go back) or at a CHARACTER (`dead_end: false`, so call the name).
- `text` has no "?" and is the clue for a CHARACTER child.
- `players` lists TIREUR first. `awaiting` tells each client whose turn it is: `QUESTION` = Découvreur (ask / call a name / go back), `ANSWER` = Tireur answers, `GUESS_CONFIRM` = Tireur confirms `pending_guess`.
- `dsa_go_back(p_step_index)` takes the 0-based `path[].step_index` of the question to ask again.
- `dsa_rewind(p_count)` takes 1–3.

**Revealed path:** `{status, winner, path, secret}`, where `secret` is `{node_id, name, description}` only after DISCOVERED/ABANDONED.

**Realtime (S6):** subscribe to `postgres_changes` on `game_sessions` (`id=eq.<id>`), `game_moves` and `game_players` (`game_session_id=eq.<id>`), and call `dsa_get_state` on each event. Broadcast channel `room:<ROOM_CODE>`, events `offer`/`answer`/`ice`/`hangup`.

**AI_DECOUVREUR (S3):** after each human answer or confirmation, the client calls `dsa_ai_decouvreur_step` while `awaiting = QUESTION`. The server doesn't chain turns on its own.

**Importer (S4):**
- Upsert with the service role on `id`, using the same UUID v5 names as `packages/core/src/keys.ts`.
- `import_batches.status` ∈ `PENDING/VALIDATED/APPLIED/FAILED/DISCARDED`.
- Only `APPROVED` rows are playable.
- `metadata.group_kind` is CHECK-constrained to `CLASSE/TOME/ALIAS/OTHER`.
- `graph_edges` doesn't allow self-loops.

**Admin (S5):** full CRUD on the graph tables through RLS once the user is in `admin_users` (`02_make_admin.sql`). `dsa_is_admin()` can be called as an RPC to gate the UI.

**Core (S1):** `dsa_answer_class` and `dsa_normalize` now match `answerClass` and `normalizeName` on the shared inputs. Any change to those rules must be made in both places.

## 6. Open questions

1. **Security (for S8): deterministic node ids can leak a leaf's name.**
   - Players can see `prompt.node_id` (spec §3), `path[].node_id`, `game_sessions.current_node_id` / `pending_prompt_node_id` and `game_moves.node_id`.
   - Node ids are UUID v5 of `graphSlug:node_key`, and a CHARACTER key is `parentKey/slug(clue)--slug(name)`.
   - A Découvreur who knows the key rules (the repo is public), the traversed path and the clue can hash every name from `dsa_list_names` and find the match before answering.

   Suggested fix: expose a per-session opaque prompt id (for example an HMAC of session id + node id, or a step counter) instead of the node id, and drop the node columns from player-readable rows or replace them the same way. This changes the spec's JSON, so it's the lead's decision.
2. **AI Découvreur loop with a mistaken human Tireur.** Mirroring the core, it goes back to the latest NON. If the actual mistake was an earlier OUI, it can cycle until the Tireur uses "QUESTION". Should it remember what it already tried?
3. **Stale rooms** stay `PLAYING` forever (and keep their code) when players just close the app. Should there be a scheduled cleanup (for example abandon after 24 h idle, via `pg_cron` in the dashboard)?
4. **`AUTRE` edge labels.** Core's `sameAnswer` treats two AUTRE labels as equal when their letters match. The SQL doesn't offer AUTRE edges as answers at all. Should such edges exist in the book graph, or should the validator reject them?
5. **Hosted confirmation.** Please report the owner's actual `90_tests.sql` result, especially that the role switching and the final advisory-lock line behave in the dashboard as they do in PGlite.
