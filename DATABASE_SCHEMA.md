# DATABASE SCHEMA — DSA

The Supabase (PostgreSQL) side of the project. It implements `GRAPH_SPECIFICATION.md` §2 (rules) and §3 (database).

- Source: `supabase/migrations/0001…0006` (0006 = game UX iteration, GRAPH_SPECIFICATION §8).
- What the owner runs: `supabase/sql-editor/` (see its `README.md`).
- Tests: `supabase/sql-editor/90_tests.sql`.

Contents:
1. [Tables](#1-tables)
2. [Row level security](#2-row-level-security)
3. [RPCs](#3-rpcs)
4. [Realtime and WebRTC signaling](#4-realtime-and-webrtc-signaling)
5. [Secret protection](#5-secret-protection)
6. [Setup in the Supabase dashboard](#setup-in-the-supabase-dashboard)
7. [Troubleshooting](#troubleshooting)

---

## 1. Tables

Every table is in the `public` schema. `id` columns are `uuid` (`gen_random_uuid()` by default; graph rows use deterministic UUID v5 ids from the importer). Enum-like text columns are enforced with CHECK constraints.

### Graph tables (admin-only)

**`graphs`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | v5(namespace, `slug`) |
| slug | text, unique | `livre`, `mini` |
| name, description | text | |
| version | int ≥ 1 | |
| is_active | bool | |
| status | text | `DRAFT` \| `PUBLISHED`. Only published, active graphs can be played (admins can play any). |
| source_document | text | |
| metadata | jsonb | |
| created_at, updated_at | timestamptz | `updated_at` is set by trigger |

**`graph_versions`**: `id`, `graph_id` → graphs (cascade), `version` (unique per graph), `status` (`DRAFT`/`PUBLISHED`), `snapshot` jsonb, `notes`, `created_by` → auth.users (set null), `created_at`.

**`bible_characters`**: one row per person (card). Alias leaves share one row.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | v5(namespace, `graphSlug:character:<primary node key>`) |
| name | text | |
| name_fr, name_en | text | |
| gender | text | `M` \| `F` \| null |
| testament | text | `ANCIEN` \| `NOUVEAU` \| null |
| description | text | `"<clue> · <nearest CATEGORY label>"` |
| aliases | text[] | |
| is_active | bool | |
| metadata | jsonb | |
| created_at, updated_at | timestamptz | |

**`graph_nodes`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | v5(namespace, `graphSlug:node_key`) |
| graph_id | uuid → graphs | on delete cascade |
| node_key | text | unique with `graph_id` |
| node_type | text | `START` `QUESTION` `CATEGORY` `GROUP` `CHARACTER` `REFERENCE` `END` |
| label | text | the book's wording; the NAME for a CHARACTER |
| question | text | the clue of a CHARACTER |
| description | text | |
| character_id | uuid → bible_characters | on delete set null |
| source_page | int | PDF page |
| position_x, position_y | double | editor layout |
| review_status | text | `DRAFT` `NEEDS_REVIEW` `APPROVED` `REJECTED`; only `APPROVED` is playable |
| review_note | text | |
| metadata | jsonb | `group_kind` ∈ `CLASSE`/`TOME`/`ALIAS`/`OTHER` (checked), `qualifier`, `printed_page`, … |
| created_at, updated_at | timestamptz | |

Indexes: `graph_id`, `character_id`, `(graph_id, node_type)`.

**`graph_edges`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | v5(namespace, `graphSlug:fromKey->toKey`) |
| graph_id | uuid → graphs | cascade |
| from_node_id, to_node_id | uuid → graph_nodes | cascade; no self-loops |
| answer_label | text | canonical label as printed on p2 (`OUI`, `NONONONON`, …) |
| edge_kind | text | `DECISION` \| `HIERARCHY` \| `SYSTEM` |
| order_index | int | **book order**; ties are broken by `id` |
| source_page | int | |
| review_status, review_note | text | as for nodes |
| metadata | jsonb | `source_variants: [{label, page}]` |
| created_at, updated_at | timestamptz | |

Indexes: `graph_id`, `from_node_id`, `to_node_id`, `(from_node_id, order_index)`.

**`admin_users`**: `user_id` PK → auth.users (cascade), `note`, `created_at`.

**`import_batches`**

| Column | Notes |
|---|---|
| id | |
| graph_id | → graphs, cascade |
| graph_slug | |
| source | |
| status | `PENDING` `VALIDATED` `APPLIED` `FAILED` `DISCARDED` |
| stats, report | jsonb |
| created_by | → auth.users, set null |
| created_at, updated_at, applied_at | |

### Game tables

**`game_sessions`**: no secret column.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| graph_id | uuid → graphs | cascade |
| mode | text | `HUMAN_VS_HUMAN` `AI_TIREUR` `AI_DECOUVREUR` `LOCAL` |
| status | text | `WAITING` → `PLAYING` → `DISCOVERED` \| `ABANDONED` (`READY` is allowed but unused) |
| room_code | text | `DSA-####`; unique among open sessions (`WAITING`/`READY`/`PLAYING`) |
| awaiting | text | `QUESTION` (Découvreur acts), `ANSWER` (Tireur answers), `GUESS_CONFIRM` (Tireur confirms a name), `NONE` (not playing) |
| current_node_id | uuid → graph_nodes | derived position; set null on node delete |
| child_cursor | int ≥ 0 | derived position |
| pending_prompt_node_id | uuid → graph_nodes | the asked prompt while `awaiting = ANSWER` |
| pending_guess | text | the called name while `awaiting = GUESS_CONFIRM` |
| winner | text | `TIREUR` \| `DECOUVREUR` \| null |
| settings | jsonb, not null, default `{}` | Chosen at creation (`dsa_create_session(p_settings)`), checked to be an object. Stored normalized: `{"input_mode": "VOICE" \| "BUTTONS"}` (default `BUTTONS`). Reserved for the §9 timer values. |
| created_by | uuid → auth.users | |
| started_at, ended_at, created_at, updated_at | timestamptz | |

**`game_players`**

| Column | Notes |
|---|---|
| id | |
| game_session_id | → game_sessions, cascade |
| user_id | → auth.users; null for AI players |
| role | `TIREUR` \| `DECOUVREUR`; unique `(game_session_id, role)` |
| display_name | |
| is_ai | the AI side of AI_TIREUR / AI_DECOUVREUR |
| joined_at | |

In LOCAL mode the creator holds both rows.

**`game_moves`**: the full history. The live `ANSWER` rows are the "answered steps" replayed by the rules.

| Column | Notes |
|---|---|
| id, seq | `seq` is an identity column giving insertion order |
| game_session_id | → game_sessions, cascade |
| move_type | `QUESTION` `ANSWER` `GUESS` `GUESS_CONFIRM` `BACK` `REWIND` `SYSTEM` |
| step_index | 0-based. On ANSWER/QUESTION: the step's index. On GUESS/GUESS_CONFIRM: the number of steps at that time. On BACK/REWIND: the number of steps kept. |
| actor_role, actor_user_id, is_ai | who acted (`SYSTEM` for automatic moves) |
| answer_label | ANSWER: the book's canonical label for the given class. GUESS_CONFIRM: `OUI`/`NON`. |
| node_id | the prompt node (QUESTION/ANSWER) |
| payload | jsonb: `text` (prompt text), `kind`, `answer_class`, `spoken_label`, `name`, `count`, `event` |
| is_undone | true once removed by BACK/REWIND; the row is kept |
| created_at | |

A partial unique index allows at most one live ANSWER per `(session, step_index)`.

**`game_messages`**

| Column | Notes |
|---|---|
| id | |
| game_session_id | → game_sessions, cascade |
| user_id | defaults to `auth.uid()` |
| role | |
| kind | `CHAT` \| `TRANSCRIPT` |
| body | 1–2000 chars |
| created_at | |

**`game_secrets`**

| Column | Notes |
|---|---|
| game_session_id | PK → game_sessions, cascade |
| secret_node_id | → graph_nodes, cascade |
| secret_character_id | → bible_characters, set null |
| created_at | |

---

## 2. Row level security

RLS is enabled on every table. The `anon` role (not signed in) has **no** table privileges. Anonymous sign-ins use the `authenticated` role, like normal accounts. The service role bypasses RLS and is for local import scripts only.

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| graphs, graph_versions, bible_characters, graph_nodes, graph_edges, import_batches | admins | admins |
| admin_users | admins | nobody (SQL Editor / service role only) |
| game_sessions, game_players, game_moves | players of that session | nobody (privileges revoked; RPCs only) |
| game_secrets | the session's **TIREUR** only | nobody |
| game_messages | players of that session | INSERT by players, with `user_id = auth.uid()`; no update/delete |

Policies call three `SECURITY DEFINER` helpers, so a policy never queries a table protected by another policy, and there is no recursion:

- `dsa_is_admin()`;
- `dsa_is_session_player(session_id)`;
- `dsa_player_role(session_id)`, which returns `TIREUR`, `DECOUVREUR` or null. A LOCAL creator holds both, and `TIREUR` is returned.

These three are executable by `authenticated` only.

---

## 3. RPCs

Every RPC is `SECURITY DEFINER` with `search_path = public, pg_temp`. They are granted to `authenticated` only and require `auth.uid()`. Session-changing RPCs lock the session row (`FOR UPDATE`), so concurrent calls are serialized.

Call them from the client with `supabase.rpc('dsa_ask', { p_session_id })`. Functions that return a table (`dsa_create_session`, `dsa_join_session`, `dsa_get_my_secret`) return an **array with one row**, so use `.single()`.

**Errors.** Intentional errors are raised with SQLSTATE `P0001`, and the message starts with a stable code followed by `: `. For example, `DSA_WRONG_ROLE: only the TIREUR can do this`. Match on the prefix (`error.message.split(':')[0]`).

### Signatures

| Function | Caller | Returns | Effect | Error codes |
|---|---|---|---|---|
| `dsa_create_session(p_graph_slug text, p_mode text, p_role text default null, p_display_name text default null, p_settings jsonb default '{}')` | any signed-in user | `table(session_id uuid, room_code text)` | Picks a random playable secret and a free `DSA-####` code (retries on collision). HUMAN_VS_HUMAN: caller takes `p_role`, status `WAITING`. AI_TIREUR: caller is DECOUVREUR; AI_DECOUVREUR: caller is TIREUR (an AI player row is added). LOCAL: caller holds both roles. Non-HvH sessions start `PLAYING` immediately. `p_settings` (0006): a JSON object whose only allowed key is `input_mode` (`VOICE` \| `BUTTONS`, default `BUTTONS`); null is treated as `{}`. The room creator chooses it for both players. | NOT_AUTHENTICATED, INVALID_MODE, INVALID_ROLE, INVALID_SETTINGS, GRAPH_NOT_FOUND, GRAPH_INVALID, NO_PLAYABLE_SECRET, ROOM_CODE_EXHAUSTED |
| `dsa_join_session(p_room_code text, p_display_name text default null)` | any signed-in user | `table(session_id uuid, role text)` | Takes the free role of an open HUMAN_VS_HUMAN room; the game starts. Accepts `DSA-1234`, `dsa1234` or `1234`. Joining again returns the role already held. | NOT_AUTHENTICATED, ROOM_NOT_FOUND, ROOM_FULL |
| `dsa_get_my_secret(p_session_id uuid)` | TIREUR | `table(node_id uuid, name text, description text, has_homonyms boolean)` | The card: `name` is the node label (exact name), and `description` is "clue · section". `has_homonyms` (0006): another CHARACTER of the graph, reachable through APPROVED edges, has the same `dsa_normalize(label)` and a **different** `character_id` (ABRAHAM/ABRAM are one person). Clients show the description only when it is true. | NOT_PLAYER, WRONG_ROLE |
| `dsa_get_state(p_session_id uuid)` | players | jsonb state (below) | read-only | NOT_PLAYER |
| `dsa_ask(p_session_id uuid)` | DÉCOUVREUR | jsonb state | Asks the current prompt (`awaiting` → `ANSWER`). In AI_TIREUR mode the correct answer is recorded immediately. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_QUESTION, NO_PROMPT |
| `dsa_answer(p_session_id uuid, p_answer_label text)` | TIREUR | jsonb state | The label's class must be allowed by the prompt. Records the step with the book's canonical label and re-derives the position. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_ANSWER, NO_PROMPT, ANSWER_NOT_ALLOWED |
| `dsa_guess(p_session_id uuid, p_name text)` | DÉCOUVREUR | jsonb state | Sets `pending_guess` (`awaiting` → `GUESS_CONFIRM`). AI_TIREUR mode confirms immediately. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_QUESTION, INVALID_NAME |
| `dsa_confirm_guess(p_session_id uuid, p_answer_label text)` | TIREUR | jsonb state | `OUI` → `DISCOVERED`, `winner = DECOUVREUR`. `NON` → back to `QUESTION`, same position. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_GUESS_CONFIRM, ANSWER_NOT_ALLOWED |
| `dsa_go_back(p_session_id uuid, p_step_index int)` | DÉCOUVREUR | jsonb state | Keeps the first `p_step_index` steps (0-based), so step `p_step_index` is asked again. Later steps get `is_undone`. Allowed while awaiting QUESTION or ANSWER. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_QUESTION, INVALID_STEP |
| `dsa_rewind(p_session_id uuid, p_count int)` | TIREUR | jsonb state | "QUESTION ×N": removes the last N steps (1–3, at most the number of steps). A question waiting for its answer is dropped too. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_ANSWER, INVALID_REWIND |
| `dsa_ai_decouvreur_step(p_session_id uuid)` | TIREUR, AI_DECOUVREUR mode | jsonb state | The server plays the Découvreur. At a CHARACTER it calls the label; with a prompt it asks; at a dead end it goes back to the latest step answered `NON`. | NOT_PLAYER, WRONG_ROLE, WRONG_MODE, GAME_OVER, NOT_AWAITING_QUESTION, NO_PROMPT |
| `dsa_abandon(p_session_id uuid)` | player | jsonb state | `ABANDONED` | NOT_PLAYER, GAME_OVER |
| `dsa_get_revealed_path(p_session_id uuid)` | players | jsonb (below) | Live steps, the game's stats, and the secret after `DISCOVERED`/`ABANDONED`. | NOT_PLAYER |
| `dsa_list_names(p_graph_slug text)` | any signed-in user | `text[]` | Sorted distinct CHARACTER labels, character names and aliases. No structure. | NOT_AUTHENTICATED, GRAPH_NOT_FOUND |

All codes are prefixed with `DSA_` in the actual message, e.g. `DSA_ROOM_FULL`.

### `dsa_get_state` JSON

```json
{
  "status": "PLAYING",
  "mode": "HUMAN_VS_HUMAN",
  "awaiting": "QUESTION",
  "prompt": {
    "node_id": "c372af08-04a9-5a9c-8b90-ad1a35b862a0",
    "text": "PENTATEUQUE",
    "node_type": "QUESTION",
    "answer_classes": ["OUI", "NON", "NON_REPETE"]
  },
  "dead_end": false,
  "pending_guess": null,
  "path": [
    { "step_index": 0, "node_id": "198e148c-…", "text": "ANCIEN", "answer_label": "OUI",
      "prompt_kind": "SPINE", "node_type": "QUESTION", "target_text": "HOMME" },
    { "step_index": 1, "node_id": "e4a9f7ee-…", "text": "HOMME", "answer_label": "OUI",
      "prompt_kind": "SPINE", "node_type": "QUESTION", "target_text": "PENTATEUQUE" }
  ],
  "players": [
    { "role": "TIREUR", "display_name": "Awa", "is_ai": false, "is_me": false },
    { "role": "DECOUVREUR", "display_name": "Bill", "is_ai": false, "is_me": true }
  ],
  "settings": { "input_mode": "BUTTONS" }
}
```

- `prompt` is `null` unless `status = PLAYING` and there is a question here. With `prompt = null` while playing, `dead_end: true` means "go back", and `dead_end: false` means a CHARACTER was reached (call the name).
- `prompt.text` is the label for a QUESTION/CATEGORY/GROUP, and the clue for a CHARACTER child. There is no trailing "?".
- `node_type` is the prompt node's type. `answer_classes` is `["OUI","NON"]` for a child prompt.
- `path[].answer_label` is the book's canonical label (for example `NONONONON` even if the Tireur said "NONONO").
- `path[]` fields added by 0006 (they only describe what the answer already revealed):
  - `prompt_kind`: `SPINE` (a QUESTION node with answer codes) or `CHILD` (an item of a CATEGORY/GROUP list);
  - `node_type`: the prompt node's type (`QUESTION`, `CATEGORY`, `GROUP` for TOME/CLASSE, `CHARACTER` for a clue);
  - `target_text`: SPINE only, the prompt text of the node the answer entered (`LIE A DAVID` after `LIVRE DE SAMUEL = OUIOUIOUI`); `null` for CHILD. It goes through `dsa_prompt_text`, so a CHARACTER target would show its clue, never its name.
- `settings` (0006): the session settings, so the second player of a room reads the creator's choices.

### `dsa_get_revealed_path` JSON

```json
{
  "status": "DISCOVERED",
  "winner": "DECOUVREUR",
  "path": [ { "step_index": 0, "node_id": "…", "text": "ANCIEN", "answer_label": "OUI",
              "prompt_kind": "SPINE", "node_type": "QUESTION", "target_text": "HOMME" } ],
  "stats": { "questions": 7, "non": 1, "backs": 0, "rewinds": 0 },
  "secret": { "node_id": "…", "name": "CAÏN", "description": "Le meurtrier · LIE A ADAM", "has_homonyms": false }
}
```

- `secret` is `null` until the game ends.
- `stats` (0006) counts **every** move of the session, undone ones included, like `GameEngine.stats()` in `packages/core`: `questions` = QUESTION moves, `non` = ANSWER moves of class `NON` (not the repeated code), `backs` = BACK moves, `rewinds` = REWIND moves.

### Internal functions (not callable by clients)

- **Rules (mirror of `packages/core/src/rules.ts`):**
  - `dsa_normalize`, `dsa_answer_class`;
  - `dsa_prompt_at`, `dsa_derive_position` (replays the live ANSWER steps), `dsa_current_prompt`;
  - `dsa_compute_answer`, `dsa_is_correct_name`, `dsa_canonical_label`;
  - `dsa_ai_tireur_answer`, `dsa_ai_decouvreur_action`.
- **Graph walks:** `dsa_is_ancestor_or_self` and `dsa_playable_characters` (recursive CTEs over APPROVED nodes and edges only).
- **Transitions:** `dsa_do_ask`, `dsa_do_answer`, `dsa_do_guess`, `dsa_do_confirm_guess`, `dsa_do_go_back`, `dsa_do_rewind`, `dsa_do_truncate`.
- **Plumbing:** `dsa_state_json`, `dsa_path_json`, `dsa_require_player`, …
- **0006:** `dsa_has_homonyms(node_id)`, `dsa_game_stats(session_id)`, `dsa_normalize_settings(jsonb)`.

EXECUTE is revoked from `public`, `anon` and `authenticated` for all of these.

---

## 4. Realtime and WebRTC signaling

- **Postgres Changes.** The `supabase_realtime` publication contains `game_sessions`, `game_players` and `game_moves` (replica identity full). **`game_secrets` is never published** (0005 removes it if someone adds it). Realtime applies the SELECT policies, so a subscriber only receives rows of sessions they play in. When a change arrives, call `dsa_get_state(session_id)`; don't rebuild state from row payloads.

  ```ts
  supabase.channel(`game:${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_moves', filter: `game_session_id=eq.${sessionId}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` }, refresh)
    .subscribe();
  ```

- **WebRTC signaling** uses a Realtime **broadcast** channel named `room:<ROOM_CODE>` (for example `room:DSA-1234`), with events `offer`, `answer`, `ice` and `hangup`. Nothing is stored in the database.

---

## 5. Secret protection

1. **The secret lives only in `game_secrets`.** `game_sessions` has no secret column, so neither table reads nor realtime payloads of sessions can carry it.
2. **`game_secrets` RLS** lets only the session's TIREUR read the row. There are no client writes, and the table is not in the realtime publication.
3. **The Découvreur never reads the graph.** The graph tables are admin-only. Clients see only what the RPCs return:
   - `dsa_get_state`: the current prompt plus the traversed path, never future nodes;
   - `dsa_list_names`: a flat name list;
   - `dsa_get_revealed_path`: the secret only after the end.
4. **Correct-answer logic** (`dsa_compute_answer`, `dsa_ai_tireur_answer`, `dsa_is_correct_name`, …) runs only inside SECURITY DEFINER RPCs. EXECUTE is not granted to `authenticated`.
5. **Tests.** `90_tests.sql` checks all of this (scenario 12, extended in 0006 to the new path fields and `has_homonyms`): the Découvreur sees 0 secret rows, `dsa_get_my_secret` fails, the state never contains the secret's id or name before it is the current prompt, graph writes are refused, and `dsa_compute_answer` is not executable.

Known limitation: see the S2 report. Node ids are deterministic UUID v5 values of the book path, and `prompt.node_id` / `current_node_id` are visible to players. A determined player who has the node-key rules and the name list could compute the id of a leaf and match it.

---

## Setup in the Supabase dashboard

You need a free Supabase account at <https://supabase.com>. No command line is needed.

### 1. Create the project

1. **New project** → pick an organization.
2. Name it (for example `dsa`) and set a **database password** (keep it in a password manager).
3. Pick a region close to the players (for example *West EU* / *Central EU*).
4. Wait until the project dashboard is ready (1–2 minutes).

### 2. Run the SQL files

In the left sidebar open **SQL Editor** → **New query**. For each file below, open it in the repo, copy **all** of it, paste it into the editor, then click **Run** (or press Ctrl+Enter):

1. `supabase/sql-editor/00_all_migrations.sql`: expect "Success. No rows returned".
   - **A project that already ran an older `00`** (before the game UX update) runs `supabase/sql-editor/03_game_ux.sql` instead, then `90`. Running the new `00` again also works.
2. `supabase/sql-editor/01_seed_mini_graph.sql`: expect one row `mini_nodes 30 · mini_edges 29 · mini_characters 12`.
3. `supabase/sql-editor/90_tests.sql`: expect one row **`ALL DSA TESTS PASSED`**. It takes a few seconds and changes nothing (it rolls back).

If the editor warns that a query contains destructive operations or has RLS implications, confirm. The files only create DSA objects, and `90` undoes its own changes.

### 3. Enable anonymous sign-ins

**Authentication** → **Sign In / Providers** (called *Providers* in some dashboard versions) → turn on **Allow anonymous sign-ins** → **Save**. Players can then play without creating an account.

Optional: **Authentication → Settings / Attack Protection** lets you enable CAPTCHA to limit anonymous sign-up abuse.

### 4. Make yourself an admin

1. Sign up or sign in once with your email. Use the admin app, or **Authentication → Users → Add user → Create new user** in the dashboard.
2. Open `supabase/sql-editor/02_make_admin.sql`, replace `REPLACE_WITH_YOUR_EMAIL` with that email, paste the file into the SQL Editor and **Run**.
3. Expect a row with your user id and email.

### 5. Check realtime

**Database** → **Publications** → `supabase_realtime`: the tables `game_sessions`, `game_players` and `game_moves` must be enabled, and **`game_secrets` must not be**. Migration `0005` already set this up; this step only checks it.

### 6. Copy the API keys

**Project Settings** (gear icon) → **API** (in newer dashboards: **Data API** for the URL and **API Keys** for the keys):

| Value | Where it goes |
|---|---|
| **Project URL** (`https://<ref>.supabase.co`) | `EXPO_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` in Vercel (both projects) and local `.env` |
| **anon / public** key (or the *publishable* key) | `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role** key (or the *secret* key) | `SUPABASE_SERVICE_ROLE_KEY`, **local import scripts only**. Never put it in Vercel, in an app, or in git. It bypasses all security. |

In Vercel: Project → **Settings → Environment Variables**. Add the two public variables to the Expo web project and to the admin project, then redeploy.

---

## Troubleshooting

| Error / symptom | Cause and fix |
|---|---|
| `DSA TEST SETUP: run 00_all_migrations.sql first` / `run 01_seed_mini_graph.sql first` | Run the files in order: 00, 01, then 90. |
| `DSA TEST SETUP: this project predates the game UX update; run 03_game_ux.sql …` | The project was set up with an older `00`. Run `03_game_ux.sql`, then `90` again. |
| App: `DSA_INVALID_SETTINGS` | `p_settings` has an unknown key, or `input_mode` is not `VOICE`/`BUTTONS`. |
| `DSA TEST FAILED [<scenario>]: …` | A rule or policy doesn't behave as the spec says. Nothing was saved (rollback). Copy the full message into the report for the lead. |
| `DSA TESTS DID NOT COMPLETE` | An error stopped the script before the end. Look for the first error above it. |
| `relation "auth.users" does not exist` | You're not in a Supabase project's SQL Editor (or it's a plain Postgres). The migrations need Supabase Auth. |
| `function extensions.uuid_generate_v5(...) does not exist` | `uuid-ossp` is installed in another schema. Run `drop extension "uuid-ossp"; create extension "uuid-ossp" with schema extensions;` (only if nothing else uses it), then run `01` again. |
| `cannot change return type of existing function` | A function signature changed between versions. Run `drop function public.<name>(<arg types>);` for the function named in the error, then run `00` again. |
| `No user with email … in auth.users` (02) | Sign in once first (step 4.1), and check the email's spelling. |
| `Edit 02_make_admin.sql first` | Replace `REPLACE_WITH_YOUR_EMAIL` with your email. |
| App: `DSA_NOT_AUTHENTICATED` | The client didn't sign in. Call `supabase.auth.signInAnonymously()` first, and check that anonymous sign-ins are enabled (step 3). |
| App: `permission denied for function dsa_…` | The call was made without a session (the `anon` role). Sign in first. Internal functions (`dsa_compute_answer`, …) are never callable from clients. |
| App: `DSA_GRAPH_NOT_FOUND` | The graph slug is wrong, or the graph isn't `PUBLISHED` and `is_active`. |
| App: `DSA_NO_PLAYABLE_SECRET` | No APPROVED CHARACTER is reachable from START through APPROVED edges. Approve nodes and edges in the admin. |
| App: `DSA_ROOM_NOT_FOUND` | The code is wrong, or the room has already ended. |
| App: `DSA_INVALID_STEP: step N no longer matches the graph` | The graph was edited (a node or edge un-approved or re-ordered) during a game. Start a new game. |
| Admin app shows no graphs | Your user isn't in `admin_users`. Run `02` with the email you sign in with. |
| Realtime events don't arrive | Check step 5, and that the client subscribes after signing in. RLS filters events to players of the session. |
