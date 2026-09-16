# Brief S2 — Supabase database: SQL for the dashboard SQL Editor

You are a senior PostgreSQL and Supabase engineer on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game (Tireur vs Découvreur, played by voice, with multiplayer rooms). Repo: `/home/winner/projects/DSA`.

## Read first, completely
1. `docs/sessions/README.md` (global rules)
2. `GAME_RULES.md`
3. `GRAPH_SPECIFICATION.md`: especially §1 (constraints), §2 (traversal rules, which you mirror in SQL) and §3 (tables, RPCs, realtime)
4. `docs/sessions/mini-graph-fixture.md`: the seed and the scenarios your SQL tests must implement
5. `DIGITIZATION_REPORT.md` §3 (background)

## Hard constraints
- **No Docker.** Never run `supabase start`, `db reset`, `test db`, `link` or `db push`. There is no database available to you.
- The owner pastes files by hand into the **hosted Supabase dashboard SQL Editor**, so every file must run cleanly as one paste, in the numbered order, on a fresh project, and **re-running it must not fail** (idempotent: `create … if not exists`, `create or replace function`, `drop policy if exists` then `create policy`, guarded `alter publication`, `do $$ … $$` guards for types and constraints).
- Don't run npm install in the repo. To syntax-check SQL without a database you **may** install a Postgres parser in your scratch/tmp directory, outside the repo (for example `npm i libpg-query` or `pgsql-parser` there), and parse each file. This is strongly recommended. Also review ordering by hand: objects created before they are used, no RLS recursion, correct `security definer` and `search_path`.
- Don't git commit. Don't touch anything outside what you own.

## You own
`supabase/**` and `DATABASE_SCHEMA.md`.

## Deliver

### 1. `supabase/migrations/` (ordered; for a future `supabase db push`)
- `0001_graph_schema.sql`:
  - tables `graphs`, `graph_versions`, `bible_characters`, `graph_nodes`, `graph_edges`, `admin_users`, `import_batches`, with every column from the brief plus the §3 additions;
  - CHECK constraints for every enum-like text column, foreign keys (`on delete cascade` from graph to nodes and edges; character to node `set null`), and unique `(graph_id, node_key)`;
  - indexes on `graph_id`, `from_node_id`, `to_node_id` and `(from_node_id, order_index)`;
  - an `updated_at` trigger.
- `0002_game_schema.sql`:
  - `game_sessions` with the columns in §3 (mode, status, room_code unique, awaiting, current_node_id, child_cursor, pending_prompt_node_id, pending_guess, started_at, ended_at, winner, created_at, graph_id) and **no secret column**;
  - `game_players` (unique `(game_session_id, role)`), `game_moves` (move_type, step_index, answer_label, node_id, payload, is_undone), `game_messages`, `game_secrets`.
- `0003_functions.sql`:
  - helpers `dsa_is_admin()`, `dsa_is_session_player(session)`, `dsa_player_role(session)` (SECURITY DEFINER, used by policies to avoid recursion), `dsa_normalize(text)` (unaccent-free implementation using `translate`, or enable the `unaccent` extension in the `extensions` schema), and `dsa_answer_class(label)`;
  - the SQL mirror of the spec §2 rules: `dsa_derive_position(session)` (replays the non-undone ANSWER steps in step order), `dsa_current_prompt(session)`, `dsa_compute_answer(session)` and `dsa_is_correct_name(session, name)`. Only APPROVED nodes and edges count; use recursive CTEs for ancestor-or-self;
  - every RPC in §3 with exactly those names, parameters and behaviours, including AI_TIREUR auto-answers inside `dsa_ask` and `dsa_guess`, `dsa_ai_decouvreur_step` mirroring the core AI (character → guess its label; prompt → ask; dead end → back to the latest NON step), and `dsa_list_names`;
  - room codes `DSA-####`, retried on collision; random secret among playable CHARACTER nodes; LOCAL mode gives the creator both player rows;
  - raise errors with stable codes at the start of the message: `DSA_NOT_PLAYER`, `DSA_WRONG_ROLE`, `DSA_NOT_AWAITING_QUESTION`, `DSA_NOT_AWAITING_ANSWER`, `DSA_NO_PROMPT`, `DSA_ANSWER_NOT_ALLOWED`, `DSA_INVALID_STEP`, `DSA_INVALID_REWIND`, `DSA_GAME_OVER`, `DSA_ROOM_NOT_FOUND`, `DSA_ROOM_FULL`;
  - `dsa_get_state` returns jsonb exactly as described in §3, and must never include the secret before the end;
  - `revoke all … from public, anon, authenticated` on the internal functions; `grant execute` to `authenticated` on the RPCs (anonymous sign-in users are `authenticated`).
- `0004_rls.sql`:
  - enable RLS on every table;
  - graph tables: admins get full CRUD; everyone else gets nothing;
  - `game_sessions`, `game_players`, `game_moves`: SELECT for session players only, and no client INSERT/UPDATE/DELETE (all writes go through SECURITY DEFINER RPCs);
  - `game_secrets`: SELECT only where `dsa_player_role(session) = 'TIREUR'`;
  - `admin_users`: admins can read;
  - `game_messages`: players can read, and insert their own.
- `0005_realtime.sql`: add `game_sessions`, `game_players` and `game_moves` to the `supabase_realtime` publication (guarded); `replica identity full` where useful; **never `game_secrets`**.

### 2. `supabase/sql-editor/` (what the owner actually runs)
- `00_all_migrations.sql`: every migration concatenated in order, generated by `supabase/sql-editor/build.sh` (bash, no Docker). Also commit the generated file.
- `01_seed_mini_graph.sql`: the mini graph from `mini-graph-fixture.md`, exactly. Use `extensions.uuid_generate_v5` (enable `uuid-ossp` in schema `extensions`) with the fixture's namespace and names, and upsert on id.
- `02_make_admin.sql`: `insert into admin_users` by looking up `auth.users` by email, with an obvious `REPLACE_WITH_YOUR_EMAIL` placeholder.
- `90_tests.sql`: a single paste. `begin;` … `rollback;`.
  - Create throwaway `auth.users` rows, and simulate users with `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);`, resetting role between actors.
  - Use a test-only way to force a secret: as the `postgres` role, update `game_secrets` directly after `dsa_create_session`.
  - Implement scenarios **1–12** from `mini-graph-fixture.md` with `do $$ … assert … $$` blocks, and add HUMAN_VS_HUMAN create/join, the room code format, `DSA_ROOM_FULL`, and AI_TIREUR auto-answer.
  - Every failure must raise a clear message naming the scenario. On success, the script's last select returns `ALL DSA TESTS PASSED`.
  - State at the top that it rolls back and requires `01_seed_mini_graph.sql` to have been run.
- `README.md` in that folder: the order to run things.

### 3. `DATABASE_SCHEMA.md` (repo root)
- Tables and columns.
- An RLS summary per table.
- RPC signatures, callers, effects and error codes.
- Realtime and the WebRTC broadcast channel naming.
- The secret-protection design.
- **"Setup in the Supabase dashboard"**, step by step for a non-expert:
  1. create the project;
  2. SQL Editor: run `00`, then `01`, then `90` (expect `ALL DSA TESTS PASSED`);
  3. Authentication → Sign In / Providers → enable **Anonymous sign-ins**;
  4. sign up or sign in once, then run `02` with the owner's email;
  5. Database → Publications: check `supabase_realtime` contains the three game tables;
  6. Project Settings → API: where to find the URL and anon key (for the Expo and Next.js env vars on Vercel) and the service role key (**local import scripts only**).
- Troubleshooting for common errors.

## Report
Write `docs/sessions/reports/S2-database.md` with:
- the file list;
- how you syntax-checked (tool and result per file);
- a hand-review checklist of ordering, recursion and idempotency;
- deviations from spec §3, with reasons;
- anything the other sessions must know (exact RPC JSON shapes);
- open questions.
