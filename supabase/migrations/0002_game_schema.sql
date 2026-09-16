-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0002_game_schema.sql — game sessions, players, moves, messages, secrets
--
-- Idempotent. Requires 0001.
-- The secret NEVER lives in game_sessions: it is in game_secrets, which only
-- the session's TIREUR can read (0004) and which is never published (0005).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- game_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.game_sessions (
  id                     uuid primary key default gen_random_uuid(),
  graph_id               uuid not null references public.graphs (id) on delete cascade,
  mode                   text not null,
  status                 text not null default 'WAITING',
  room_code              text not null,
  awaiting               text not null default 'NONE',
  current_node_id        uuid references public.graph_nodes (id) on delete set null,
  child_cursor           integer not null default 0,
  pending_prompt_node_id uuid references public.graph_nodes (id) on delete set null,
  pending_guess          text,
  winner                 text,
  created_by             uuid references auth.users (id) on delete set null,
  started_at             timestamptz,
  ended_at               timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint game_sessions_mode_check check (mode in ('HUMAN_VS_HUMAN', 'AI_TIREUR', 'AI_DECOUVREUR', 'LOCAL')),
  constraint game_sessions_status_check check (status in ('WAITING', 'READY', 'PLAYING', 'DISCOVERED', 'ABANDONED')),
  constraint game_sessions_awaiting_check check (awaiting in ('QUESTION', 'ANSWER', 'GUESS_CONFIRM', 'NONE')),
  constraint game_sessions_winner_check check (winner is null or winner in ('TIREUR', 'DECOUVREUR')),
  constraint game_sessions_room_code_check check (room_code ~ '^DSA-[0-9]{4}$'),
  constraint game_sessions_child_cursor_check check (child_cursor >= 0)
);

-- Room codes are unique among sessions that are still open. Finished sessions
-- release their code (4 digits = 10,000 codes; a global unique would run out).
create unique index if not exists game_sessions_room_code_open_uidx
  on public.game_sessions (room_code)
  where status in ('WAITING', 'READY', 'PLAYING');

create index if not exists game_sessions_graph_id_idx on public.game_sessions (graph_id);
create index if not exists game_sessions_room_code_idx on public.game_sessions (room_code);

drop trigger if exists game_sessions_set_updated_at on public.game_sessions;
create trigger game_sessions_set_updated_at
  before update on public.game_sessions
  for each row execute function public.dsa_set_updated_at();

-- -----------------------------------------------------------------------------
-- game_players: one row per role. LOCAL = the creator holds both rows.
-- AI roles get a row with user_id null and is_ai = true.
-- -----------------------------------------------------------------------------
create table if not exists public.game_players (
  id              uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,
  role            text not null,
  display_name    text,
  is_ai           boolean not null default false,
  joined_at       timestamptz not null default now(),
  constraint game_players_session_role_key unique (game_session_id, role),
  constraint game_players_role_check check (role in ('TIREUR', 'DECOUVREUR')),
  constraint game_players_ai_user_check check ((is_ai and user_id is null) or (not is_ai and user_id is not null))
);

create index if not exists game_players_user_id_idx on public.game_players (user_id);
create index if not exists game_players_session_user_idx on public.game_players (game_session_id, user_id);

-- -----------------------------------------------------------------------------
-- game_moves: full history. ANSWER rows are the "answered steps" replayed by
-- dsa_derive_position. Undone steps are kept with is_undone = true.
-- -----------------------------------------------------------------------------
create table if not exists public.game_moves (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  move_type       text not null,
  step_index      integer,
  actor_role      text,
  actor_user_id   uuid references auth.users (id) on delete set null,
  is_ai           boolean not null default false,
  answer_label    text,
  node_id         uuid references public.graph_nodes (id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  is_undone       boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint game_moves_move_type_check check (
    move_type in ('QUESTION', 'ANSWER', 'GUESS', 'GUESS_CONFIRM', 'BACK', 'REWIND', 'SYSTEM')
  ),
  constraint game_moves_actor_role_check check (actor_role is null or actor_role in ('TIREUR', 'DECOUVREUR', 'SYSTEM')),
  constraint game_moves_step_index_check check (step_index is null or step_index >= 0),
  constraint game_moves_answer_step_check check (move_type <> 'ANSWER' or (step_index is not null and answer_label is not null))
);

create index if not exists game_moves_session_seq_idx on public.game_moves (game_session_id, seq);
create index if not exists game_moves_session_type_step_idx
  on public.game_moves (game_session_id, move_type, step_index)
  where not is_undone;

-- At most one live (not undone) answered step per index.
create unique index if not exists game_moves_live_answer_step_uidx
  on public.game_moves (game_session_id, step_index)
  where move_type = 'ANSWER' and not is_undone;

-- -----------------------------------------------------------------------------
-- game_messages: chat / transcripts between players
-- -----------------------------------------------------------------------------
create table if not exists public.game_messages (
  id              uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role            text,
  kind            text not null default 'CHAT',
  body            text not null,
  created_at      timestamptz not null default now(),
  constraint game_messages_role_check check (role is null or role in ('TIREUR', 'DECOUVREUR')),
  constraint game_messages_kind_check check (kind in ('CHAT', 'TRANSCRIPT')),
  constraint game_messages_body_check check (char_length(body) between 1 and 2000)
);

create index if not exists game_messages_session_created_idx on public.game_messages (game_session_id, created_at);

-- -----------------------------------------------------------------------------
-- game_secrets: the secret card of a session. TIREUR-only (see 0004).
-- -----------------------------------------------------------------------------
create table if not exists public.game_secrets (
  game_session_id     uuid primary key references public.game_sessions (id) on delete cascade,
  secret_node_id      uuid not null references public.graph_nodes (id) on delete cascade,
  secret_character_id uuid references public.bible_characters (id) on delete set null,
  created_at          timestamptz not null default now()
);
