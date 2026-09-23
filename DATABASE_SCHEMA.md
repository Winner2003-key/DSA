# DATABASE SCHEMA — DSA

The Supabase (PostgreSQL) side of the project. It implements `GRAPH_SPECIFICATION.md` §2 (rules) and §3 (database).

- Source: `supabase/migrations/0001…0009` (0006 = game UX iteration, GRAPH_SPECIFICATION §8; 0007 = voice rate limit, see `VOICE.md`; 0008 = rooms on two devices, brief S6; 0009 = the optional timer, the name change and the book's path, GRAPH_SPECIFICATION §9, brief S9).
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
| status | text | `WAITING` → `PLAYING` → `DISCOVERED` \| `ABANDONED` \| `TIME_UP` (`READY` is allowed but unused). (0009) `TIME_UP` ends a timed game whose game time ran out: `winner` is null and both players lose. |
| room_code | text | `DSA-####`; unique among open sessions (`WAITING`/`READY`/`PLAYING`) |
| awaiting | text | `QUESTION` (Découvreur acts), `ANSWER` (Tireur answers), `GUESS_CONFIRM` (Tireur confirms a name), `NONE` (not playing) |
| current_node_id | uuid → graph_nodes | derived position; set null on node delete |
| child_cursor | int ≥ 0 | derived position |
| pending_prompt_node_id | uuid → graph_nodes | the asked prompt while `awaiting = ANSWER` |
| pending_guess | text | the called name while `awaiting = GUESS_CONFIRM` |
| winner | text | `TIREUR` \| `DECOUVREUR` \| null |
| settings | jsonb, not null, default `{}` | Chosen at creation (`dsa_create_session(p_settings)`), checked to be an object. A client may send only `input_mode` (`VOICE` \| `BUTTONS`, default `BUTTONS`) and, since 0009, `timed` (boolean, default `false`). Stored normalized, with the server's own copies: `{"input_mode": …, "timed": …, "max_redraws": 2}` plus `"think_seconds"` and `"play_seconds"` when `timed`. Those copies are what make a running game immune to a later change in `app_settings`. |
| created_by | uuid → auth.users | |
| tireur_ready_at | timestamptz | (0008, generalized by 0009) When the preparation phase ended — "Je suis prêt", or the thinking deadline in a timed game. **Only `AI_TIREUR` is ready at creation**; LOCAL, AI_DECOUVREUR and HUMAN_VS_HUMAN all start with it null. While it is null in a PLAYING session, nobody can ask, call a name or let the AI Découvreur play (`DSA_TIREUR_NOT_READY`). |
| think_ends_at | timestamptz | (0009) Timed games: the end of the thinking time, set when the preparation phase starts. Once the phase is over it holds **when the thinking actually ended**. Null in an untimed game. |
| play_ends_at | timestamptz | (0009) Timed games: the end of the game time, fixed when the thinking ends (`tireur_ready_at + play_seconds`) and **never moved again** — rewinds, going back and wrong name calls all spend the same seconds. Null in an untimed game. |
| rematch_of | uuid → game_sessions | (0008) The finished room this one was created from by `dsa_rematch`; set null if that session is deleted. |
| started_at, ended_at, created_at, updated_at | timestamptz | `updated_at` is set by trigger on every transition, so it is the time of the last activity (stale-room cleanup). |

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
| previous_node_ids | uuid[], not null, default `{}`. (0009) Every card drawn earlier in this game, so `dsa_redraw_secret` never draws one twice. Its length is the number of changes used. It is as private as the secret itself: the RLS policy below covers the whole row, and only the count ever reaches a client. |
| created_at | |

**`app_settings`** (0009): one row, the admin's "Réglages" page.

| Column | Notes |
|---|---|
| id | boolean PK, default true, CHECK `id` — so the table can only ever hold this one row |
| think_seconds | int, default 40, CHECK 10–600. How long the Tireur has to work out the path. |
| play_seconds | int, default 120, CHECK 30–1800. How long the players then have to find the name. |
| max_redraws | int, default 2, CHECK 0–5. How many times a Tireur may draw another name before the start; 0 turns the feature off. |
| updated_at | timestamptz, set by trigger |
| updated_by | uuid → auth.users, set null |

These are the values a **new** game copies. A game already being played keeps its own (`game_sessions.settings`), so changing them never shortens a running clock.

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
| app_settings (0009) | admins | UPDATE by admins. No INSERT and no DELETE for anyone: the single row is seeded by the migration. RPCs read it as the owner through `dsa_app_settings()`, so players never touch the table. |

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
| `dsa_create_session(p_graph_slug text, p_mode text, p_role text default null, p_display_name text default null, p_settings jsonb default '{}')` | any signed-in user | `table(session_id uuid, room_code text)` | Picks a random playable secret and a free `DSA-####` code (retries on collision). HUMAN_VS_HUMAN: caller takes `p_role`, status `WAITING`. AI_TIREUR: caller is DECOUVREUR; AI_DECOUVREUR: caller is TIREUR (an AI player row is added). LOCAL: caller holds both roles. Non-HvH sessions start `PLAYING` immediately. `p_settings` (0006, extended by 0009 and 0010): a JSON object whose allowed keys are `input_mode` (`VOICE` \| `BUTTONS`, default `BUTTONS`), `timed` (boolean, default false) and `scope` (an array of section node ids, default empty = the whole book); null is treated as `{}`. Any other key is `DSA_INVALID_SETTINGS`. The room creator chooses them for both players. The secret is drawn inside `scope`. | NOT_AUTHENTICATED, INVALID_MODE, INVALID_ROLE, INVALID_SETTINGS, GRAPH_NOT_FOUND, GRAPH_INVALID, NO_PLAYABLE_SECRET, ROOM_CODE_EXHAUSTED |
| `dsa_join_session(p_room_code text, p_display_name text default null)` | any signed-in user | `table(session_id uuid, role text)` | Takes the free role of an open HUMAN_VS_HUMAN room; the game starts. Accepts `DSA-1234`, `dsa1234` or `1234`. Joining again returns the role already held. | NOT_AUTHENTICATED, ROOM_NOT_FOUND, ROOM_FULL |
| `dsa_get_my_secret(p_session_id uuid)` | TIREUR | `table(node_id uuid, name text, description text, has_homonyms boolean)` | (0009) Refused with `DSA_WAITING_FOR_PLAYER` while the session is still `WAITING`/`READY`, so a room's Tireur cannot read the card — and start thinking — before the clock starts. The card: `name` is the node label (exact name), and `description` is "clue · section". `has_homonyms` (0006): another CHARACTER of the graph, reachable through APPROVED edges, has the same `dsa_normalize(label)` and a **different** `character_id` (ABRAHAM/ABRAM are one person). Clients show the description only when it is true. | NOT_PLAYER, WRONG_ROLE, WAITING_FOR_PLAYER |
| `dsa_get_state(p_session_id uuid)` | players | jsonb state (below) | read-only | NOT_PLAYER |
| `dsa_ask(p_session_id uuid)` | DÉCOUVREUR | jsonb state | Asks the current prompt (`awaiting` → `ANSWER`). In AI_TIREUR mode the correct answer is recorded immediately. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_QUESTION, NO_PROMPT |
| `dsa_answer(p_session_id uuid, p_answer_label text)` | TIREUR | jsonb state | The label's class must be allowed by the prompt. Records the step with the book's canonical label and re-derives the position. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_ANSWER, NO_PROMPT, ANSWER_NOT_ALLOWED |
| `dsa_guess(p_session_id uuid, p_name text)` | DÉCOUVREUR | jsonb state | Sets `pending_guess` (`awaiting` → `GUESS_CONFIRM`). AI_TIREUR mode confirms immediately. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_QUESTION, INVALID_NAME |
| `dsa_confirm_guess(p_session_id uuid, p_answer_label text)` | TIREUR | jsonb state | `OUI` → `DISCOVERED`, `winner = DECOUVREUR`. `NON` → back to `QUESTION`, same position. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_GUESS_CONFIRM, ANSWER_NOT_ALLOWED |
| `dsa_go_back(p_session_id uuid, p_step_index int)` | DÉCOUVREUR | jsonb state | Keeps the first `p_step_index` steps (0-based), so step `p_step_index` is asked again. Later steps get `is_undone`. Allowed while awaiting QUESTION or ANSWER. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, NOT_AWAITING_QUESTION, INVALID_STEP |
| `dsa_rewind(p_session_id uuid, p_count int)` | TIREUR | jsonb state | "QUESTION ×N" (0010, same signature, new semantics): goes back to the question that **opened the list** the pair is in, N lists up (GAME_RULES §4). A step enters a level when it is a SPINE answer or a child prompt answered `OUI`; a `NON` on a child does not. The N-th most recent entering step and everything after it are undone, and that step's own question is asked again. Fewer than N entering steps → back to the very first question, **not** an error. A question waiting for its answer is dropped too. `INVALID_REWIND` only for N outside 1–3 or an empty path. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, TIME_UP, NOT_AWAITING_ANSWER, INVALID_REWIND |
| `dsa_ai_decouvreur_step(p_session_id uuid)` | TIREUR, AI_DECOUVREUR mode | jsonb state | The server plays the Découvreur. At a CHARACTER it calls the label; with a prompt it asks; at a dead end it goes back to the latest step answered `NON`. | NOT_PLAYER, WRONG_ROLE, WRONG_MODE, GAME_OVER, NOT_AWAITING_QUESTION, NO_PROMPT |
| `dsa_abandon(p_session_id uuid)` | player | jsonb state | `ABANDONED` | NOT_PLAYER, GAME_OVER |
| `dsa_get_revealed_path(p_session_id uuid)` | players | jsonb (below) | Live steps, the game's stats, and the secret after `DISCOVERED`/`ABANDONED`. | NOT_PLAYER |
| `dsa_list_names(p_graph_slug text)` | any signed-in user | `text[]` | Sorted distinct CHARACTER labels, character names and aliases. No structure. | NOT_AUTHENTICATED, GRAPH_NOT_FOUND |
| `dsa_tireur_ready(p_session_id uuid)` | TIREUR | jsonb state | (0008, generalized by 0009) Ends the **preparation phase**, in every mode with a human Tireur: sets `tireur_ready_at` once and records a `SYSTEM` move `{"event": "TIREUR_READY", "reason": "READY"}`. In a timed game this is also where `play_ends_at` is fixed. Calling it again changes nothing. Needs status PLAYING (`DSA_WAITING_FOR_PLAYER` in a room whose second player has not arrived). AI_TIREUR is ready from creation, so it is a no-op there. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, TIME_UP, WAITING_FOR_PLAYER |
| `dsa_redraw_secret(p_session_id uuid)` | TIREUR | jsonb state | (0009) "Changer de nom". Draws another playable card, never one already drawn in this session (`game_secrets.previous_node_ids`). **Only during the preparation phase** — before `tireur_ready_at` and before any QUESTION/ANSWER/GUESS move — otherwise `DSA_GAME_STARTED`. After `settings.max_redraws` it raises `DSA_NO_REDRAW_LEFT`. In a timed game it restarts `think_ends_at`. Records a `SYSTEM` move `{"event": "REDRAW"}`, which carries no node and no name. | NOT_PLAYER, WRONG_ROLE, GAME_OVER, TIME_UP, WAITING_FOR_PLAYER, GAME_STARTED, NO_REDRAW_LEFT, NO_PLAYABLE_SECRET |
| `dsa_check_time(p_session_id uuid)` | players | jsonb state | (0009) Applies the clock now and returns the state. It is how an idle client turns a game whose time has run out into `TIME_UP` — and the only call that **records** the transition, because every other RPC raises `DSA_TIME_UP`, which rolls its own transaction back. Never raises `DSA_TIME_UP` itself. A no-op in an untimed game. | NOT_PLAYER |
| `dsa_timer_defaults()` | any signed-in user | jsonb `{think_seconds, play_seconds, max_redraws}` | (0009) The current `app_settings`, so "Préparer la partie" can write the real durations under the chronometer checkbox. These are the rules of the game, not a secret; only admins may write them. | NOT_AUTHENTICATED |
| `dsa_list_sections(p_graph_slug text)` | any signed-in user | `table(node_id uuid, label text, parent_id uuid, depth int, characters int)` | (0010) The book's sections for the « Choisir une partie » picker, in book order: every approved non-CHARACTER node reachable from START (the spine questions are sections too), with the number of playable names underneath. Returns **no name, no clue and no leaf** — no more than the table of contents. | NOT_AUTHENTICATED, GRAPH_NOT_FOUND, GRAPH_INVALID |
| `dsa_get_solution_path(p_session_id uuid)` | players | jsonb (below) | (0009) The book's own path from START to the secret. **Only once the session is `DISCOVERED`, `TIME_UP` or `ABANDONED`**; before that it would hand the Découvreur the answer. | NOT_PLAYER, GAME_NOT_OVER |
| `dsa_rematch(p_session_id uuid, p_swap_roles boolean default false)` | a human player of that finished HUMAN_VS_HUMAN session | `table(session_id uuid, room_code text, role text)` | (0008) "Rejouer". First call: a new WAITING room on the same graph with the same settings and the caller's display name, `rematch_of` = the old session; the caller keeps their role, or takes the other one with `p_swap_roles`. Later calls (the other player accepting, or both pressing "Rejouer" at once): join that open rematch and take the free role (`p_swap_roles` is ignored); the game starts. The old session row is locked, so two calls can't create two rooms. Only players of the old session can reach the new room this way. | NOT_PLAYER, WRONG_MODE, GAME_NOT_OVER, ROOM_FULL, GRAPH_NOT_FOUND, NO_PLAYABLE_SECRET, ROOM_CODE_EXHAUSTED |

**0009 changes to existing RPCs:**
- **Every mutating RPC checks the deadline first.** `dsa_ask`, `dsa_answer`, `dsa_guess`, `dsa_confirm_guess`, `dsa_go_back`, `dsa_rewind`, `dsa_ai_decouvreur_step`, `dsa_abandon`, `dsa_tireur_ready` and `dsa_redraw_secret` all run `dsa_tick` on the locked row and then `dsa_assert_time`, before `DSA_GAME_OVER` and before the role and state checks. A move that arrives after the limit therefore never lands.
  - **A raise rolls its own transaction back**, so the refused call leaves the session untouched — it does not write `TIME_UP`. `dsa_check_time` is what records the transition, and the app calls it when its countdown reaches zero or when it sees `DSA_TIME_UP`. The other device learns of it over Realtime like any other change.
- `dsa_ask`, `dsa_guess` and `dsa_ai_decouvreur_step` raise `DSA_TIREUR_NOT_READY` in **every** mode but AI_TIREUR until `dsa_tireur_ready` (0008 only did it for HUMAN_VS_HUMAN rooms).
- `dsa_create_session` accepts `timed` in `p_settings`, and copies `think_seconds`/`play_seconds` (when timed) and `max_redraws` (always) from `app_settings`.
- `dsa_rematch` also accepts a `TIME_UP` session as finished, and carries over the creator's two choices (`input_mode`, `timed`). The durations are copied afresh, because the rematch is a new game.
- `dsa_get_revealed_path` treats `TIME_UP` as an end (the name is revealed), and its `stats` gain `timed`, `play_seconds` and `found_in_seconds`.

**0008 changes to existing RPCs:**
- `dsa_create_session` and `dsa_join_session` first run `dsa_cleanup_stale_sessions()` (below), so a room that went idle is closed and its code is free again. A join refused with `DSA_ROOM_NOT_FOUND` rolls back that cleanup with the rest of the call; the next successful create/join (or the cron job) closes the room for good.
- `dsa_ask` and `dsa_guess` raise `DSA_TIREUR_NOT_READY` in a PLAYING HUMAN_VS_HUMAN room whose Tireur has not called `dsa_tireur_ready`. `DSA_GAME_OVER` is checked first.

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
  "settings": { "input_mode": "BUTTONS", "timed": true, "max_redraws": 2, "think_seconds": 40, "play_seconds": 120 },
  "tireur_ready": true,
  "room_code": "DSA-1234",
  "timed": true,
  "phase": "PLAYING",
  "think_ends_at": "2026-09-17T12:00:12+00:00",
  "play_ends_at": "2026-09-17T12:02:12+00:00",
  "server_now": "2026-09-17T12:00:48+00:00",
  "redraws_used": 1,
  "redraws_left": 1,
  "scope_labels": ["LES EVANGILES"]
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
- `settings` (0006): the session settings, so the second player of a room reads the creator's choices. `settings.scope` (0010) is present **only** when a part of the book was chosen, so an untouched game's settings keep exactly the shape they had before.
- `scope_labels` (0010): the chosen sections' labels in book order, so the game screen can write « Partie : LES EVANGILES » without a second call. `[]` for the whole book. Labels only — a section is never a name.
- `tireur_ready` (0008): `false` only while a room's Tireur is still looking at the card. Clients show the Tireur the card and "Je suis prêt", and the Découvreur "Le Tireur découvre sa carte…". It says nothing about the card.
- `room_code` (0008): the room's `DSA-####` code (players can already read it from `game_sessions`). The lobby shows it, and the room's Realtime channel is `room:<room_code>`.
- **0009, the clock and the name changes:**
  - `timed`: this game is played with the chronometer.
  - `phase`: `THINKING` while the Tireur still has the card, `PLAYING` from the first question. It mirrors `tireur_ready` and is what the app branches on.
  - `think_ends_at` / `play_ends_at`: the deadlines, or null in an untimed game. `play_ends_at` appears only once the thinking has ended, and never moves afterwards.
  - **`server_now`**: the server's own clock at the moment it answered. **Clients must compute their countdown from this**, never from the device clock: a phone whose clock is wrong, or that has just come back from the background, still shows the right seconds. It is sent for untimed games too.
  - `redraws_used` / `redraws_left`: how many times the Tireur has drawn another name, and how many are left. **Never which names** — those stay in `game_secrets`, which only the Tireur can read.

### `dsa_get_revealed_path` JSON

```json
{
  "status": "DISCOVERED",
  "winner": "DECOUVREUR",
  "path": [ { "step_index": 0, "node_id": "…", "text": "ANCIEN", "answer_label": "OUI",
              "prompt_kind": "SPINE", "node_type": "QUESTION", "target_text": "HOMME" } ],
  "stats": { "questions": 7, "non": 1, "backs": 0, "rewinds": 0,
             "timed": true, "play_seconds": 120, "found_in_seconds": 72 },
  "secret": { "node_id": "…", "name": "CAÏN", "description": "Le meurtrier · LIE A ADAM", "has_homonyms": false }
}
```

- `secret` is `null` until the game ends — `DISCOVERED`, `ABANDONED` or, since 0009, `TIME_UP`.
- `stats` (0006) counts **every** move of the session, undone ones included, like `GameEngine.stats()` in `packages/core`: `questions` = QUESTION moves, `non` = ANSWER moves of class `NON` (not the repeated code), `backs` = BACK moves, `rewinds` = REWIND moves.
- `stats` (0009) also carries:
  - `timed`: the game was played with the chronometer;
  - `play_seconds`: the limit the players had, or null when untimed;
  - `found_in_seconds`: from the start of the game phase (`tireur_ready_at`) to the discovery (`ended_at`), rounded to the second; null unless the status is `DISCOVERED`. The result screen writes "Trouvé en 1 min 12 s sur 2 min" from these two.

### `dsa_get_solution_path` JSON (0009)

```json
{
  "status": "TIME_UP",
  "path": [ { "step_index": 0, "node_id": "…", "text": "ANCIEN", "answer_label": "OUI",
              "prompt_kind": "SPINE", "node_type": "QUESTION", "target_text": "HOMME" } ],
  "secret": { "node_id": "…", "name": "CAÏN", "description": "Le meurtrier · LIE A ADAM", "has_homonyms": false }
}
```

The book's own way to the name: every spine question with its correct code, then inside each section its children in book order, answered `NON` until the one answered `OUI`, down to the card. It is **not** the players' path — no detour, no back-step, no refused name.

`path[]` entries have exactly the shape of `dsa_get_state().path[]`, so the app renders them with the same `PathGraph`. The mirror in `packages/core` is `solutionPath(ix, secretNodeId)`, and `90_tests.sql` block 17 checks, for every playable card of `mini`, that replaying this path in a real game lands on that card.

### Internal functions (not callable by clients)

- **Rules (mirror of `packages/core/src/rules.ts`):**
  - `dsa_normalize`, `dsa_answer_class`;
  - `dsa_prompt_at`, `dsa_derive_position` (replays the live ANSWER steps), `dsa_current_prompt`;
  - `dsa_compute_answer`, `dsa_is_correct_name`, `dsa_canonical_label`;
  - `dsa_ai_tireur_answer`, `dsa_ai_decouvreur_action`.
- **Graph walks:** `dsa_is_ancestor_or_self`, `dsa_playable_characters` and `dsa_graph_tree` (0010: the book as a tree — parent, depth, ancestors and book order, cycle-safe), all recursive CTEs over APPROVED nodes and edges only.
- **Transitions:** `dsa_do_ask`, `dsa_do_answer`, `dsa_do_guess`, `dsa_do_confirm_guess`, `dsa_do_go_back`, `dsa_do_rewind`, `dsa_do_truncate`.
- **Plumbing:** `dsa_state_json`, `dsa_path_json`, `dsa_require_player`, …
- **0006:** `dsa_has_homonyms(node_id)`, `dsa_game_stats(session_id)`, `dsa_normalize_settings(jsonb)`.
- **0008:** `dsa_new_session(...)` (the body of session creation, shared by `dsa_create_session` and `dsa_rematch`), `dsa_assert_tireur_ready(session)`, and `dsa_cleanup_stale_sessions(p_idle interval default '6 hours')`.
- **0009:** `dsa_app_settings()` (the single row, with the spec's defaults if it were missing), `dsa_end_thinking(session, at, reason)`, `dsa_tick(session)` (applies the deadlines and returns the row as it now is), `dsa_assert_time(session)` and `dsa_solution_path(graph_id, secret_node_id)`. `dsa_start_play` and `dsa_normalize_settings` are rewritten by 0009; `dsa_normalize_settings` becomes `stable` rather than `immutable`, because it now reads `app_settings`.
- **0010:** `dsa_replay(session)` (every live step with its prompt kind, answer class and whether it **enters a level** — the mirror of `entersLevel`/`enteringStepIndices`), `dsa_rewind_target(session, count)`, `dsa_sections(graph_id)`, `dsa_scope_characters(graph_id, scope)` and `dsa_settings_scope(settings)`. `dsa_do_rewind`, `dsa_new_session`, `dsa_redraw_secret`, `dsa_state_json` and `dsa_rematch` are rewritten by 0010.
  - **`dsa_normalize_settings` changes signature** to `(p_settings jsonb, p_graph_id uuid)`, because a scope can only be validated against a graph. The one-argument version is **dropped** by the migration: leaving it would make every call ambiguous.

### Stale rooms (0008)

`dsa_cleanup_stale_sessions(p_idle)` closes open sessions (`WAITING`/`READY`/`PLAYING`) whose `updated_at` is older than `p_idle` (default 6 hours, at least 1 minute): status `ABANDONED`, `awaiting = NONE`, `ended_at = now()`, plus a `SYSTEM` move `{"event": "ABANDONED", "reason": "IDLE"}`. Finished sessions are never touched. It uses the partial index `game_sessions_open_updated_at_idx`, handles at most 500 sessions per call, skips rows another transaction holds, and returns how many it closed. It is not granted to clients.

It already runs at the start of every `dsa_create_session`, `dsa_join_session` and `dsa_rematch`. **Optional:** to also close rooms when nobody creates or joins a game, schedule it with pg_cron:

1. Dashboard → **Integrations** → **Cron** → enable it (this installs the `pg_cron` extension).
2. **Create job**: name `dsa-cleanup-stale-sessions`, schedule `17 * * * *` (every hour), type **SQL snippet**, command `select public.dsa_cleanup_stale_sessions();`.

   The same thing from the SQL Editor, once pg_cron is enabled:

   ```sql
   select cron.schedule('dsa-cleanup-stale-sessions', '17 * * * *', $$select public.dsa_cleanup_stale_sessions()$$);
   -- to remove it: select cron.unschedule('dsa-cleanup-stale-sessions');
   ```

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

- **The room channel** `room:<ROOM_CODE>` (for example `room:DSA-1234`, public, not stored in the database) carries:
  - **presence** (0008, `apps/mobile/src/rooms/room-channel.ts`): each device tracks `{role, name, activity: "active" | "away", at}`. The lobby shows each seat as connected, away (app in the background) or disconnected;
  - **broadcast** `rematch` `{old_session_id, session_id, room_code, swap, from_role, from_name}` and `rematch_declined` `{old_session_id, session_id, from_name}`. An offer is only a hint: accepting it calls `dsa_rematch(old_session_id, swap)`, which checks that the caller played in that session;
  - **WebRTC signaling** (S7c): events `offer`, `answer`, `ice` and `hangup`, on the same channel, which the app has already joined for presence.

  Anyone who knows a room code can join this public channel, so nothing on it is trusted for the game itself (see S6 report, open questions).
- **The app's game subscription** (0008, `SupabaseGameService.subscribe`) uses its own channel per session (`game:<session_id>:<n>`) with the three `postgres_changes` bindings above. Events are debounced (150 ms) into one `dsa_get_state`, and while the channel is not `SUBSCRIBED` the app polls every 5 s instead.

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
   - **A project that already ran `00` before the rooms update** runs `supabase/sql-editor/05_rooms.sql` (after `03` if it needed that), then `90`. `05` stops with a clear message if `03` is missing.
   - **A project that already ran `00` before the timed-games update** runs `supabase/sql-editor/06_timer.sql` (after `05`), then `90`. `06` stops with a clear message if `05` is missing.
   - **A project that already ran `00` before the rules-and-practice update** runs `supabase/sql-editor/07_rules_scope.sql` (after `06`), then `90`. `07` stops with a clear message if `06` is missing. Paste the upgrade files in increasing order: running an older one after a newer one puts the older functions back (see `supabase/sql-editor/README.md`).
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
| App: `DSA_INVALID_SETTINGS` | `p_settings` has a key other than `input_mode` and `timed`, `input_mode` is not `VOICE`/`BUTTONS`, or `timed` is not a boolean. The durations are the server's to fill in; a client never sends them. |
| `DSA TEST SETUP: this project predates the rooms update; run 05_rooms.sql …` | Run `05_rooms.sql`, then `90` again. |
| `DSA SETUP: this project predates the game UX update; run 03_game_ux.sql first, then this file again` (05) | Run `03_game_ux.sql`, then `05_rooms.sql` again. |
| App: `DSA_TIREUR_NOT_READY` | The Découvreur acted before the Tireur said "Je suis prêt" (a stale screen). The app waits for the push; it resolves itself. |
| App: `DSA_WAITING_FOR_PLAYER` | `dsa_tireur_ready` was called before the second player joined. |
| App: `DSA_GAME_NOT_OVER` | `dsa_rematch`, or `dsa_get_solution_path`, on a game that is still being played. The book's path is only taught once the game is over. |
| `DSA TEST SETUP: this project predates the timed-games update; run 06_timer.sql …` | Run `06_timer.sql`, then `90` again. |
| `DSA SETUP: this project predates the rooms update; run 05_rooms.sql first, then this file again` (06) | Run `05_rooms.sql`, then `06_timer.sql` again. |
| App: `DSA_TIME_UP` | The game time ran out. The app calls `dsa_check_time` and moves to the result screen, which shows the name and the book's path. |
| App: `DSA_GAME_STARTED` | `dsa_redraw_secret` after the Tireur said "Je suis prêt" or after the first question. The name can no longer change; only `dsa_abandon` is left. |
| App: `DSA_NO_REDRAW_LEFT` | The Tireur has used all `settings.max_redraws` name changes (admin → Réglages). |
| The clock seems to keep running after the time is up | Nothing was moving, so nobody told the server. Any player's `dsa_check_time` records it; the app does that by itself when its countdown reaches zero. |
| An admin changed the durations and a game in progress did not follow | That is the rule: `think_seconds` and `play_seconds` are copied into `game_sessions.settings` when the game is created. The next game takes the new values. |
| App: "Could not find the function public.dsa_tireur_ready" | `05_rooms.sql` has not been run on this project. |
| Rooms: presence never shows the other player | Realtime is blocked (network or firewall). The game still works: it polls every 5 s and shows "Connexion perdue… reconnexion". |
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
