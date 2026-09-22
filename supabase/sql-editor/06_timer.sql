-- =============================================================================
-- DSA — 06_timer.sql — UPGRADE: optional timer, name change, book's path (brief S9)
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * For a project that already ran 00 and 01 (and 03_game_ux.sql / 05_rooms.sql
--   if it needed them). A new project runs the regenerated 00_all_migrations.sql
--   instead, which already contains this change.
-- * Safe to run more than once.
-- * Expected result: "Success. No rows returned". Then run 90_tests.sql:
--   one row, ALL DSA TESTS PASSED.
--
-- Same content as supabase/migrations/0009_timer.sql (keep them identical).
-- =============================================================================

-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0009_timer.sql — optional timer, preparation phase, name change, solution path
--                  (GRAPH_SPECIFICATION.md §9, GAME_RULES.md "Time limits…", brief S9)
--
-- Re-runnable. Requires 0001–0006 and 0008 (0007 is independent).
--
--   1. app_settings                     one admin-editable row: think/play/max_redraws
--      dsa_app_settings()               internal reader (RPCs read it as the owner)
--   2. game_sessions.think_ends_at / play_ends_at, status TIME_UP
--      game_secrets.previous_node_ids   names already drawn in this game (private)
--   3. dsa_normalize_settings           + timed; copies the durations from app_settings
--   4. dsa_new_session                  only AI_TIREUR is ready at creation
--      dsa_start_play                   starts the clock of a timed game
--   5. dsa_end_thinking / dsa_tick / dsa_assert_time      the server-side clock
--      dsa_assert_tireur_ready          now every mode with a human Tireur
--   6. dsa_state_json                   + timed, phase, deadlines, server_now, redraws
--   7. dsa_solution_path                the book's own path to a name
--      dsa_get_solution_path            RPC, only once the game is over
--   8. dsa_get_revealed_path            + TIME_UP, timed, play_seconds, found_in_seconds
--      dsa_get_my_secret                refused while a room still waits
--   9. dsa_tireur_ready / dsa_redraw_secret / dsa_check_time
--  10. every mutating RPC               checks the deadline first (DSA_TIME_UP)
--  11. dsa_rematch                      keeps the settings the client chose
--  12. privileges
--
-- The clock is entirely server-side: one now() per call decides a move that
-- arrives at the deadline, and clients only ever render a countdown against the
-- server_now they were given. Nothing extends play_ends_at once it is set:
-- rewinds, going back and wrong name calls all spend the same game time.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Prerequisite: the rooms update (0008 / 05_rooms.sql)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_tireur_ready(uuid)') is null then
    raise exception 'DSA SETUP: this project predates the rooms update; run 05_rooms.sql first, then this file again';
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 1. app_settings: a single row the admin edits ("Réglages"). Games copy the
--    values they need at creation, so changing them never affects a running game.
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id            boolean primary key default true,
  think_seconds integer not null default 40,
  play_seconds  integer not null default 120,
  max_redraws   integer not null default 2,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  constraint app_settings_singleton_check     check (id),
  constraint app_settings_think_seconds_check check (think_seconds between 10 and 600),
  constraint app_settings_play_seconds_check  check (play_seconds between 30 and 1800),
  constraint app_settings_max_redraws_check   check (max_redraws between 0 and 5)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.dsa_set_updated_at();

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from anon;
revoke insert, delete, truncate on table public.app_settings from authenticated;
grant select, update on table public.app_settings to authenticated;
grant all on table public.app_settings to service_role;

-- Admins read and write; everyone else reads it only through the RPCs below.
drop policy if exists app_settings_admin_select on public.app_settings;
create policy app_settings_admin_select on public.app_settings
  for select to authenticated
  using (public.dsa_is_admin());

drop policy if exists app_settings_admin_update on public.app_settings;
create policy app_settings_admin_update on public.app_settings
  for update to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

-- Always one row, with the spec's defaults even if the row were missing.
create or replace function public.dsa_app_settings()
returns table (think_seconds integer, play_seconds integer, max_redraws integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(max(a.think_seconds), 40)::integer,
         coalesce(max(a.play_seconds), 120)::integer,
         coalesce(max(a.max_redraws), 2)::integer
  from public.app_settings a;
$$;


-- dsa_timer_defaults -> {think_seconds, play_seconds, max_redraws}. Any player.
-- "Préparer la partie" shows the real durations under "Jouer avec le
-- chronomètre", so the checkbox never promises a time the admin has changed.
-- These are the rules of the game, not a secret: only the admin may WRITE them.
create or replace function public.dsa_timer_defaults()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app record;
begin
  if auth.uid() is null then
    raise exception 'DSA_NOT_AUTHENTICATED: sign in first (anonymous sign-in is fine)';
  end if;
  select * into v_app from public.dsa_app_settings();
  return jsonb_build_object(
    'think_seconds', v_app.think_seconds,
    'play_seconds', v_app.play_seconds,
    'max_redraws', v_app.max_redraws
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. Session deadlines, the new TIME_UP status, and the names already drawn
-- -----------------------------------------------------------------------------
alter table public.game_sessions
  add column if not exists think_ends_at timestamptz,
  add column if not exists play_ends_at  timestamptz;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'game_sessions_status_check'
      and conrelid = 'public.game_sessions'::regclass
  ) then
    alter table public.game_sessions drop constraint game_sessions_status_check;
  end if;

  alter table public.game_sessions
    add constraint game_sessions_status_check
    check (status in ('WAITING', 'READY', 'PLAYING', 'DISCOVERED', 'ABANDONED', 'TIME_UP'));
end;
$$;

-- Every card drawn earlier in this game. Never comes back, and never leaves the
-- TIREUR's own row (game_secrets RLS, 0004).
alter table public.game_secrets
  add column if not exists previous_node_ids uuid[] not null default '{}'::uuid[];


-- -----------------------------------------------------------------------------
-- 3. Settings: clients may send input_mode and timed, nothing else. When timed
--    is true the server copies the durations, so a running game keeps them even
--    if the admin changes the Réglages page. max_redraws is always copied.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_normalize_settings(p_settings jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_unknown  text;
  v_mode     jsonb;
  v_timed    jsonb;
  v_on       boolean;
  v_app      record;
  v_out      jsonb;
begin
  if jsonb_typeof(v_settings) <> 'object' then
    raise exception 'DSA_INVALID_SETTINGS: settings must be a JSON object (got %)', jsonb_typeof(v_settings);
  end if;

  select string_agg(k, ', ' order by k) into v_unknown
  from jsonb_object_keys(v_settings) as k
  where k not in ('input_mode', 'timed');

  if v_unknown is not null then
    raise exception 'DSA_INVALID_SETTINGS: unknown setting(s): %', v_unknown;
  end if;

  v_mode := v_settings->'input_mode';
  if v_mode is null or v_mode = 'null'::jsonb then
    v_mode := to_jsonb('BUTTONS'::text);
  end if;
  if jsonb_typeof(v_mode) <> 'string' or (v_mode #>> '{}') not in ('VOICE', 'BUTTONS') then
    raise exception 'DSA_INVALID_SETTINGS: input_mode must be VOICE or BUTTONS (got %)', v_mode::text;
  end if;

  v_timed := v_settings->'timed';
  if v_timed is null or v_timed = 'null'::jsonb then
    v_timed := to_jsonb(false);
  end if;
  if jsonb_typeof(v_timed) <> 'boolean' then
    raise exception 'DSA_INVALID_SETTINGS: timed must be true or false (got %)', v_timed::text;
  end if;
  v_on := (v_timed #>> '{}')::boolean;

  select * into v_app from public.dsa_app_settings();

  v_out := jsonb_build_object(
    'input_mode', v_mode #>> '{}',
    'timed', v_on,
    'max_redraws', v_app.max_redraws
  );

  if v_on then
    v_out := v_out || jsonb_build_object(
      'think_seconds', v_app.think_seconds,
      'play_seconds', v_app.play_seconds
    );
  end if;

  return v_out;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. Creation and start of play
-- -----------------------------------------------------------------------------
-- Only the AI Tireur has no card to look at, so only AI_TIREUR is ready at
-- creation. LOCAL and AI_DECOUVREUR now start in the preparation phase too.
create or replace function public.dsa_new_session(
  p_uid          uuid,
  p_graph_id     uuid,
  p_mode         text,
  p_role         text,
  p_display_name text,
  p_settings     jsonb,
  p_rematch_of   uuid
)
returns table (session_id uuid, room_code text)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_secret_id    uuid;
  v_character_id uuid;
  v_session_id   uuid;
  v_code         text;
  v_attempt      integer;
begin
  select c.node_id into v_secret_id
  from public.dsa_playable_characters(p_graph_id) c
  order by random()
  limit 1;

  if v_secret_id is null then
    raise exception 'DSA_NO_PLAYABLE_SECRET: the graph has no playable CHARACTER node';
  end if;

  select n.character_id into v_character_id from public.graph_nodes n where n.id = v_secret_id;

  for v_attempt in 1..100 loop
    v_code := public.dsa_new_room_code();
    begin
      insert into public.game_sessions (
        graph_id, mode, status, room_code, awaiting, created_by, settings, rematch_of, tireur_ready_at
      )
      values (
        p_graph_id, p_mode, 'WAITING', v_code, 'NONE', p_uid, p_settings, p_rematch_of,
        case when p_mode = 'AI_TIREUR' then now() end
      )
      returning id into v_session_id;
      exit;
    exception when unique_violation then
      v_session_id := null;  -- room code taken by an open session: retry
    end;
  end loop;

  if v_session_id is null then
    raise exception 'DSA_ROOM_CODE_EXHAUSTED: could not find a free room code, try again';
  end if;

  insert into public.game_secrets (game_session_id, secret_node_id, secret_character_id)
  values (v_session_id, v_secret_id, v_character_id);

  if p_mode = 'LOCAL' then
    insert into public.game_players (game_session_id, user_id, role, display_name)
    values (v_session_id, p_uid, 'TIREUR', p_display_name),
           (v_session_id, p_uid, 'DECOUVREUR', p_display_name);
  else
    insert into public.game_players (game_session_id, user_id, role, display_name)
    values (v_session_id, p_uid, p_role, p_display_name);

    if p_mode in ('AI_TIREUR', 'AI_DECOUVREUR') then
      insert into public.game_players (game_session_id, user_id, role, display_name, is_ai)
      values (v_session_id, null, case p_role when 'TIREUR' then 'DECOUVREUR' else 'TIREUR' end, 'IA', true);
    end if;
  end if;

  if p_mode <> 'HUMAN_VS_HUMAN' then
    perform public.dsa_start_play(v_session_id);
  end if;

  session_id := v_session_id;
  room_code := v_code;
  return next;
end;
$$;

-- The game begins. In a timed game this is also where the clock starts:
--   * a human Tireur has not seen the card yet, so the thinking time starts
--     (in a room this is exactly the moment both players are present);
--   * the AI Tireur has no preparation phase, so the game time starts at once.
create or replace function public.dsa_start_play(p_session_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_app     record;
begin
  update public.game_sessions s
  set status = 'PLAYING',
      awaiting = 'QUESTION',
      started_at = coalesce(s.started_at, now()),
      current_node_id = public.dsa_initial_node(s.graph_id),
      child_cursor = 0,
      pending_prompt_node_id = null,
      pending_guess = null
  where s.id = p_session_id
  returning * into v_session;

  insert into public.game_moves (game_session_id, move_type, actor_role, payload)
  values (p_session_id, 'SYSTEM', 'SYSTEM', jsonb_build_object('event', 'STARTED'));

  if coalesce(v_session.settings->>'timed', 'false') <> 'true' then
    return;
  end if;

  select * into v_app from public.dsa_app_settings();

  if v_session.tireur_ready_at is null then
    update public.game_sessions s
    set think_ends_at = now() + make_interval(
          secs => coalesce(nullif(v_session.settings->>'think_seconds', '')::integer, v_app.think_seconds))
    where s.id = p_session_id;
  else
    update public.game_sessions s
    set play_ends_at = now() + make_interval(
          secs => coalesce(nullif(v_session.settings->>'play_seconds', '')::integer, v_app.play_seconds))
    where s.id = p_session_id;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. The clock
-- -----------------------------------------------------------------------------
-- Ends the preparation phase at p_at ("Je suis prêt", or the thinking deadline)
-- and, in a timed game, fixes play_ends_at once and for all.
-- p_reason: READY (the Tireur said so) or DEADLINE (the thinking time ran out).
create or replace function public.dsa_end_thinking(
  p_session public.game_sessions,
  p_at      timestamptz,
  p_reason  text
)
returns public.game_sessions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype := p_session;
  v_app     record;
  v_play    integer;
begin
  if v_session.id is null or v_session.tireur_ready_at is not null then
    return v_session;
  end if;

  select * into v_app from public.dsa_app_settings();
  v_play := coalesce(nullif(v_session.settings->>'play_seconds', '')::integer, v_app.play_seconds);

  update public.game_sessions s
  set tireur_ready_at = p_at,
      -- Keep the field meaningful: it is now "when the thinking ended".
      think_ends_at = case when s.think_ends_at is null then null else p_at end,
      play_ends_at = case
        when coalesce(s.settings->>'timed', 'false') = 'true' then p_at + make_interval(secs => v_play)
        else s.play_ends_at
      end
  where s.id = v_session.id
  returning * into v_session;

  insert into public.game_moves (game_session_id, move_type, actor_role, actor_user_id, payload)
  values (
    v_session.id, 'SYSTEM', 'TIREUR',
    case when p_reason = 'READY' then auth.uid() end,
    jsonb_build_object('event', 'TIREUR_READY', 'reason', coalesce(p_reason, 'READY'))
  );

  return v_session;
end;
$$;

-- Applies the clock to a session row (which the caller has locked) and returns
-- the row as it now is. One now() per transaction decides every deadline, so a
-- move that arrives exactly at the limit is judged once, not twice.
create or replace function public.dsa_tick(p_session public.game_sessions)
returns public.game_sessions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype := p_session;
  v_now     timestamptz := now();
begin
  if v_session.id is null
     or v_session.status <> 'PLAYING'
     or coalesce(v_session.settings->>'timed', 'false') <> 'true' then
    return v_session;
  end if;

  -- The thinking time ran out: the preparation phase ends at its own deadline,
  -- so the game time is the same length however long the Tireur actually took.
  if v_session.tireur_ready_at is null
     and v_session.think_ends_at is not null
     and v_now >= v_session.think_ends_at then
    v_session := public.dsa_end_thinking(v_session, v_session.think_ends_at, 'DEADLINE');
  end if;

  if v_session.play_ends_at is not null and v_now >= v_session.play_ends_at then
    update public.game_sessions s
    set status = 'TIME_UP',
        awaiting = 'NONE',
        winner = null,
        ended_at = v_session.play_ends_at,
        pending_prompt_node_id = null,
        pending_guess = null
    where s.id = v_session.id
    returning * into v_session;

    insert into public.game_moves (game_session_id, move_type, actor_role, payload)
    values (v_session.id, 'SYSTEM', 'SYSTEM', jsonb_build_object('event', 'TIME_UP'));
  end if;

  return v_session;
end;
$$;

-- Checked first in every mutating RPC, so no move lands after the limit.
create or replace function public.dsa_assert_time(p_session public.game_sessions)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_session.status = 'TIME_UP' then
    raise exception 'DSA_TIME_UP: the time is up';
  end if;
end;
$$;

-- Every mode with a human Tireur now has a server-side preparation phase:
-- nobody asks, calls a name or lets the AI Découvreur play until the Tireur is
-- ready (or, in a timed game, until the thinking time runs out).
create or replace function public.dsa_assert_tireur_ready(p_session public.game_sessions)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_session.status = 'PLAYING'
     and p_session.mode <> 'AI_TIREUR'
     and p_session.tireur_ready_at is null then
    raise exception 'DSA_TIREUR_NOT_READY: the Tireur is still looking at the card';
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. State JSON: 0008 plus the clock and the name changes.
--    Never says which names were drawn — only how many changes are left.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_state_json(p_session_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_session   public.game_sessions%rowtype;
  v_prompt    record;
  v_prompt_js jsonb := null;
  v_dead_end  boolean := false;
  v_node_type text;
  v_players   jsonb;
  v_timed     boolean;
  v_used      integer;
  v_max       integer;
begin
  select * into v_session from public.game_sessions s where s.id = p_session_id;

  if v_session.status = 'PLAYING' then
    select * into v_prompt from public.dsa_current_prompt(p_session_id);
    if found then
      v_prompt_js := jsonb_build_object(
        'node_id', v_prompt.prompt_node_id,
        'text', v_prompt.prompt_text,
        'node_type', v_prompt.node_type,
        'answer_classes', to_jsonb(v_prompt.answer_classes)
      );
    else
      select n.node_type into v_node_type
      from public.dsa_derive_position(p_session_id) d
      left join public.graph_nodes n on n.id = d.node_id;
      v_dead_end := v_node_type is distinct from 'CHARACTER';
    end if;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role', p.role,
        'display_name', p.display_name,
        'is_ai', p.is_ai,
        'is_me', coalesce(p.user_id = auth.uid(), false)
      )
      order by case p.role when 'TIREUR' then 0 else 1 end
    ),
    '[]'::jsonb
  ) into v_players
  from public.game_players p
  where p.game_session_id = p_session_id;

  v_timed := coalesce(v_session.settings->>'timed', 'false') = 'true';

  select coalesce(array_length(gs.previous_node_ids, 1), 0) into v_used
  from public.game_secrets gs
  where gs.game_session_id = p_session_id;
  v_used := coalesce(v_used, 0);
  v_max := coalesce(nullif(v_session.settings->>'max_redraws', '')::integer, 0);

  return jsonb_build_object(
    'status', v_session.status,
    'mode', v_session.mode,
    'awaiting', v_session.awaiting,
    'prompt', v_prompt_js,
    'dead_end', v_dead_end,
    'pending_guess', v_session.pending_guess,
    'path', public.dsa_path_json(p_session_id),
    'players', v_players,
    'settings', coalesce(v_session.settings, '{}'::jsonb),
    'tireur_ready', v_session.tireur_ready_at is not null,
    'room_code', v_session.room_code,
    'timed', v_timed,
    'phase', case when v_session.tireur_ready_at is null then 'THINKING' else 'PLAYING' end,
    'think_ends_at', v_session.think_ends_at,
    'play_ends_at', v_session.play_ends_at,
    'server_now', now(),
    'redraws_used', v_used,
    'redraws_left', greatest(0, v_max - v_used)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 7. The book's own path to a name (GRAPH_SPECIFICATION §9, "solution path").
--    Every spine question with its correct code; inside the trees, each child in
--    book order answered NON until the one answered OUI; then the name.
--    Same entry shape as dsa_path_json, so PathGraph renders it unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_solution_path(p_graph_id uuid, p_secret_node_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_node   uuid;
  v_cursor integer := 0;
  v_prompt record;
  v_class  text;
  v_label  text;
  v_next   uuid;
  v_target text;
  v_steps  jsonb := '[]'::jsonb;
  v_i      integer := 0;
begin
  if p_graph_id is null or p_secret_node_id is null then
    return v_steps;
  end if;

  v_node := public.dsa_initial_node(p_graph_id);

  -- The mini graph needs 7 steps and the book a few dozen; the bound only stops
  -- a malformed graph from looping.
  while v_i < 500 loop
    exit when v_node is null or v_node = p_secret_node_id;

    select * into v_prompt from public.dsa_prompt_at(v_node, v_cursor);
    exit when not found;

    if v_prompt.kind = 'SPINE' then
      select e.answer_class, e.answer_label, e.to_node_id
        into v_class, v_label, v_next
      from public.dsa_out_edges(v_prompt.at_node_id, 'DECISION') e
      where e.answer_class <> 'AUTRE'
        and public.dsa_is_ancestor_or_self(e.to_node_id, p_secret_node_id)
      order by e.child_position
      limit 1;

      exit when v_class is null;  -- no branch of this question holds the secret

      select public.dsa_prompt_text(t.node_type, t.label, t.question) into v_target
      from public.graph_nodes t
      where t.id = v_next;
    else
      if public.dsa_is_ancestor_or_self(v_prompt.prompt_node_id, p_secret_node_id) then
        v_class := 'OUI';
        v_next := v_prompt.prompt_node_id;
      else
        v_class := 'NON';
        v_next := null;
      end if;
      v_label := v_class;
      v_target := null;
    end if;

    v_steps := v_steps || jsonb_build_object(
      'step_index', v_i,
      'node_id', v_prompt.prompt_node_id,
      'text', v_prompt.prompt_text,
      'answer_label', v_label,
      'prompt_kind', v_prompt.kind,
      'node_type', v_prompt.node_type,
      'target_text', v_target
    );
    v_i := v_i + 1;

    if v_prompt.kind = 'SPINE' or v_class = 'OUI' then
      v_node := v_next;
      v_cursor := 0;
    else
      v_cursor := v_cursor + 1;
    end if;
  end loop;

  return v_steps;
end;
$$;

-- dsa_get_solution_path -> {status, path, secret}. Players only, and only once
-- the game is over: before that it would hand the Découvreur the answer.
create or replace function public.dsa_get_solution_path(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   public.game_sessions%rowtype;
  v_secret_id uuid;
  v_secret    jsonb := null;
begin
  v_session := public.dsa_require_player(p_session_id, null, false);

  if v_session.status not in ('DISCOVERED', 'TIME_UP', 'ABANDONED') then
    raise exception 'DSA_GAME_NOT_OVER: the book''s path is only shown once the game is over';
  end if;

  select gs.secret_node_id,
         jsonb_build_object(
           'node_id', n.id,
           'name', n.label,
           'description', coalesce(c.description, n.description),
           'has_homonyms', public.dsa_has_homonyms(n.id)
         )
    into v_secret_id, v_secret
  from public.game_secrets gs
  join public.graph_nodes n on n.id = gs.secret_node_id
  left join public.bible_characters c on c.id = coalesce(gs.secret_character_id, n.character_id)
  where gs.game_session_id = p_session_id;

  return jsonb_build_object(
    'status', v_session.status,
    'path', public.dsa_solution_path(v_session.graph_id, v_secret_id),
    'secret', v_secret
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 8. End of game and card reading
-- -----------------------------------------------------------------------------
-- stats gains timed, play_seconds (the limit) and found_in_seconds, measured
-- from the start of the game phase (tireur_ready_at) to the discovery.
create or replace function public.dsa_get_revealed_path(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_secret  jsonb := null;
  v_timed   boolean;
  v_found   integer := null;
begin
  v_session := public.dsa_require_player(p_session_id, null, false);

  if v_session.status in ('DISCOVERED', 'TIME_UP', 'ABANDONED') then
    select jsonb_build_object(
             'node_id', n.id,
             'name', n.label,
             'description', coalesce(c.description, n.description),
             'has_homonyms', public.dsa_has_homonyms(n.id)
           )
      into v_secret
    from public.game_secrets gs
    join public.graph_nodes n on n.id = gs.secret_node_id
    left join public.bible_characters c on c.id = coalesce(gs.secret_character_id, n.character_id)
    where gs.game_session_id = p_session_id;
  end if;

  v_timed := coalesce(v_session.settings->>'timed', 'false') = 'true';

  if v_session.status = 'DISCOVERED'
     and v_session.tireur_ready_at is not null
     and v_session.ended_at is not null then
    v_found := greatest(0, round(extract(epoch from v_session.ended_at - v_session.tireur_ready_at)))::integer;
  end if;

  return jsonb_build_object(
    'status', v_session.status,
    'winner', v_session.winner,
    'path', public.dsa_path_json(p_session_id),
    'stats', public.dsa_game_stats(p_session_id) || jsonb_build_object(
      'timed', v_timed,
      'play_seconds', case when v_timed then nullif(v_session.settings->>'play_seconds', '')::integer end,
      'found_in_seconds', v_found
    ),
    'secret', v_secret
  );
end;
$$;

-- The card is dealt once the game is on. In a room that means once both players
-- are present, so reading the card early buys no thinking time (S6 §6.2).
create or replace function public.dsa_get_my_secret(p_session_id uuid)
returns table (node_id uuid, name text, description text, has_homonyms boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', false);

  if v_session.status in ('WAITING', 'READY') then
    raise exception 'DSA_WAITING_FOR_PLAYER: the other player has not joined yet';
  end if;

  return query
    select n.id, n.label, coalesce(c.description, n.description), public.dsa_has_homonyms(n.id)
    from public.game_secrets gs
    join public.graph_nodes n on n.id = gs.secret_node_id
    left join public.bible_characters c on c.id = coalesce(gs.secret_character_id, n.character_id)
    where gs.game_session_id = p_session_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- 9. Preparation phase: "Je suis prêt", "Changer de nom", and the idle check
-- -----------------------------------------------------------------------------
-- dsa_tireur_ready -> state. TIREUR, every mode with a human Tireur. Ends the
-- preparation phase (and, in a timed game, starts the game clock). A second call
-- changes nothing. AI_TIREUR is ready from creation, so it is a no-op there.
create or replace function public.dsa_tireur_ready(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_assert_not_over(v_session);

  if v_session.status <> 'PLAYING' then
    raise exception 'DSA_WAITING_FOR_PLAYER: the other player has not joined yet';
  end if;

  if v_session.tireur_ready_at is null then
    v_session := public.dsa_end_thinking(v_session, now(), 'READY');
  end if;

  return public.dsa_state_json(p_session_id);
end;
$$;

-- dsa_redraw_secret -> state. TIREUR, only during the preparation phase: the
-- Tireur who cannot find this name in the book draws another one. A name already
-- drawn in this game never comes back, and the other device only learns that the
-- name changed. In a timed game the thinking time starts again.
create or replace function public.dsa_redraw_secret(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   public.game_sessions%rowtype;
  v_secret    public.game_secrets%rowtype;
  v_used      integer;
  v_max       integer;
  v_new       uuid;
  v_character uuid;
  v_app       record;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_assert_not_over(v_session);

  if v_session.status <> 'PLAYING' then
    raise exception 'DSA_WAITING_FOR_PLAYER: the other player has not joined yet';
  end if;

  -- Once the questions have started the name cannot change; only dsa_abandon is left.
  if v_session.tireur_ready_at is not null
     or exists (
       select 1 from public.game_moves m
       where m.game_session_id = p_session_id
         and m.move_type in ('QUESTION', 'ANSWER', 'GUESS')
     ) then
    raise exception 'DSA_GAME_STARTED: the name can only be changed before the questions start';
  end if;

  select * into v_secret
  from public.game_secrets gs
  where gs.game_session_id = p_session_id
  for update;

  if not found then
    raise exception 'DSA_NO_PLAYABLE_SECRET: this game has no card';
  end if;

  v_used := coalesce(array_length(v_secret.previous_node_ids, 1), 0);
  v_max := coalesce(nullif(v_session.settings->>'max_redraws', '')::integer, 0);

  if v_used >= v_max then
    raise exception 'DSA_NO_REDRAW_LEFT: no name change is left in this game (% of %)', v_used, v_max;
  end if;

  select c.node_id into v_new
  from public.dsa_playable_characters(v_session.graph_id) c
  where c.node_id <> v_secret.secret_node_id
    and not (c.node_id = any (coalesce(v_secret.previous_node_ids, '{}'::uuid[])))
  order by random()
  limit 1;

  if v_new is null then
    raise exception 'DSA_NO_PLAYABLE_SECRET: no other name is left to draw in this graph';
  end if;

  select n.character_id into v_character from public.graph_nodes n where n.id = v_new;

  update public.game_secrets gs
  set previous_node_ids = coalesce(gs.previous_node_ids, '{}'::uuid[]) || gs.secret_node_id,
      secret_node_id = v_new,
      secret_character_id = v_character
  where gs.game_session_id = p_session_id;

  if coalesce(v_session.settings->>'timed', 'false') = 'true' then
    select * into v_app from public.dsa_app_settings();
    update public.game_sessions s
    set think_ends_at = now() + make_interval(
          secs => coalesce(nullif(v_session.settings->>'think_seconds', '')::integer, v_app.think_seconds))
    where s.id = p_session_id;
  end if;

  -- "Le Tireur a changé de nom": the event, never the name.
  insert into public.game_moves (game_session_id, move_type, actor_role, actor_user_id, payload)
  values (p_session_id, 'SYSTEM', 'TIREUR', auth.uid(), jsonb_build_object('event', 'REDRAW'));

  return public.dsa_state_json(p_session_id);
end;
$$;

-- dsa_check_time -> state. Any player. Lets a client whose countdown reached
-- zero without anyone moving turn the session into TIME_UP. It never raises
-- DSA_TIME_UP: the caller wants the state, not an error.
create or replace function public.dsa_check_time(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, null, true);
  perform public.dsa_tick(v_session);
  return public.dsa_state_json(p_session_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- 10. Every mutating RPC: the deadline is checked first.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_ask(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_label   text;
begin
  v_session := public.dsa_require_player(p_session_id, 'DECOUVREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_assert_not_over(v_session);
  perform public.dsa_assert_tireur_ready(v_session);
  perform public.dsa_do_ask(p_session_id, auth.uid(), false);

  if v_session.mode = 'AI_TIREUR' then
    v_label := public.dsa_ai_tireur_answer(p_session_id);
    if v_label is null then
      raise exception 'DSA_NO_PROMPT: the AI Tireur has no answer for this question';
    end if;
    perform public.dsa_do_answer(p_session_id, v_label, null, true);
  end if;

  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_answer(p_session_id uuid, p_answer_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_do_answer(p_session_id, p_answer_label, auth.uid(), false);
  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_guess(p_session_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'DECOUVREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_assert_not_over(v_session);
  perform public.dsa_assert_tireur_ready(v_session);
  perform public.dsa_do_guess(p_session_id, p_name, auth.uid(), false);

  if v_session.mode = 'AI_TIREUR' then
    perform public.dsa_do_confirm_guess(p_session_id, public.dsa_ai_tireur_answer(p_session_id), null, true);
  end if;

  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_confirm_guess(p_session_id uuid, p_answer_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_do_confirm_guess(p_session_id, p_answer_label, auth.uid(), false);
  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_go_back(p_session_id uuid, p_step_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'DECOUVREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_do_go_back(p_session_id, p_step_index, auth.uid(), false);
  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_rewind(p_session_id uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_do_rewind(p_session_id, p_count, auth.uid(), false);
  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_ai_decouvreur_step(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_action  jsonb;
begin
  v_session := public.dsa_require_player(p_session_id, 'TIREUR', true);

  if v_session.mode <> 'AI_DECOUVREUR' then
    raise exception 'DSA_WRONG_MODE: only available in AI_DECOUVREUR mode';
  end if;

  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_assert_not_over(v_session);
  perform public.dsa_assert_tireur_ready(v_session);

  if v_session.status <> 'PLAYING' or v_session.awaiting <> 'QUESTION' then
    raise exception 'DSA_NOT_AWAITING_QUESTION: the Tireur must answer first (awaiting %)', v_session.awaiting;
  end if;

  v_action := public.dsa_ai_decouvreur_action(p_session_id);

  case v_action->>'type'
    when 'ASK' then
      perform public.dsa_do_ask(p_session_id, null, true);
    when 'GUESS' then
      perform public.dsa_do_guess(p_session_id, v_action->>'name', null, true);
    when 'BACK' then
      perform public.dsa_do_go_back(p_session_id, (v_action->>'step_index')::integer, null, true);
    else
      raise exception 'DSA_NO_PROMPT: the AI Découvreur has nothing to do here';
  end case;

  return public.dsa_state_json(p_session_id);
end;
$$;

create or replace function public.dsa_abandon(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  v_session := public.dsa_require_player(p_session_id, null, true);
  v_session := public.dsa_tick(v_session);
  perform public.dsa_assert_time(v_session);
  perform public.dsa_assert_not_over(v_session);

  update public.game_sessions s
  set status = 'ABANDONED',
      awaiting = 'NONE',
      ended_at = now(),
      pending_prompt_node_id = null,
      pending_guess = null
  where s.id = p_session_id;

  insert into public.game_moves (game_session_id, move_type, actor_role, actor_user_id, payload)
  values (
    p_session_id, 'SYSTEM', 'SYSTEM', auth.uid(),
    jsonb_build_object('event', 'ABANDONED', 'by_role', public.dsa_player_role(p_session_id))
  );

  return public.dsa_state_json(p_session_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- 11. dsa_rematch: 0008, plus TIME_UP as an end, and settings carried over as
--     the client's own choices — the durations are copied again from the current
--     app_settings, because the rematch is a new game.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_rematch(p_session_id uuid, p_swap_roles boolean default false)
returns table (session_id uuid, room_code text, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid       uuid := auth.uid();
  v_old       public.game_sessions%rowtype;
  v_me        public.game_players%rowtype;
  v_next      public.game_sessions%rowtype;
  v_existing  text;
  v_free_role text;
  v_role      text;
  v_created   record;
begin
  v_old := public.dsa_require_player(p_session_id, null, true);
  v_old := public.dsa_tick(v_old);

  if v_old.mode <> 'HUMAN_VS_HUMAN' then
    raise exception 'DSA_WRONG_MODE: only a room between two players can be replayed together';
  end if;
  if v_old.status not in ('DISCOVERED', 'ABANDONED', 'TIME_UP') then
    raise exception 'DSA_GAME_NOT_OVER: finish or leave this game first';
  end if;

  select * into v_me
  from public.game_players p
  where p.game_session_id = p_session_id and p.user_id = v_uid
  limit 1;

  perform public.dsa_cleanup_stale_sessions();

  select * into v_next
  from public.game_sessions s
  where s.rematch_of = p_session_id
    and s.status in ('WAITING', 'READY', 'PLAYING')
  order by s.created_at desc
  limit 1
  for update;

  if found then
    select p.role into v_existing
    from public.game_players p
    where p.game_session_id = v_next.id and p.user_id = v_uid
    limit 1;

    if v_existing is not null then
      session_id := v_next.id;
      room_code := v_next.room_code;
      role := v_existing;
      return next;
      return;
    end if;

    select r.role_name into v_free_role
    from (values ('TIREUR', 0), ('DECOUVREUR', 1)) as r (role_name, sort_order)
    where not exists (
      select 1 from public.game_players p
      where p.game_session_id = v_next.id and p.role = r.role_name
    )
    order by r.sort_order
    limit 1;

    if v_free_role is null then
      raise exception 'DSA_ROOM_FULL: this room already has its players';
    end if;

    insert into public.game_players (game_session_id, user_id, role, display_name)
    values (v_next.id, v_uid, v_free_role, v_me.display_name);

    if v_next.status = 'WAITING' then
      perform public.dsa_start_play(v_next.id);
    end if;

    session_id := v_next.id;
    room_code := v_next.room_code;
    role := v_free_role;
    return next;
    return;
  end if;

  v_role := case
    when coalesce(p_swap_roles, false) then case v_me.role when 'TIREUR' then 'DECOUVREUR' else 'TIREUR' end
    else v_me.role
  end;

  select * into v_created
  from public.dsa_new_session(
    v_uid,
    public.dsa_graph_for_play((select g.slug from public.graphs g where g.id = v_old.graph_id)),
    'HUMAN_VS_HUMAN',
    v_role,
    v_me.display_name,
    public.dsa_normalize_settings(jsonb_build_object(
      'input_mode', coalesce(v_old.settings->>'input_mode', 'BUTTONS'),
      'timed', coalesce((v_old.settings->>'timed')::boolean, false)
    )),
    p_session_id
  );

  session_id := v_created.session_id;
  room_code := v_created.room_code;
  role := v_role;
  return next;
end;
$$;


-- -----------------------------------------------------------------------------
-- 12. Privileges (Supabase grants EXECUTE to anon/authenticated by default)
-- -----------------------------------------------------------------------------
-- Internal: owner only.
revoke all on function public.dsa_app_settings() from public, anon, authenticated;
revoke all on function public.dsa_normalize_settings(jsonb) from public, anon, authenticated;
revoke all on function public.dsa_new_session(uuid, uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.dsa_start_play(uuid) from public, anon, authenticated;
revoke all on function public.dsa_end_thinking(public.game_sessions, timestamptz, text) from public, anon, authenticated;
revoke all on function public.dsa_tick(public.game_sessions) from public, anon, authenticated;
revoke all on function public.dsa_assert_time(public.game_sessions) from public, anon, authenticated;
revoke all on function public.dsa_assert_tireur_ready(public.game_sessions) from public, anon, authenticated;
revoke all on function public.dsa_state_json(uuid) from public, anon, authenticated;
revoke all on function public.dsa_solution_path(uuid, uuid) from public, anon, authenticated;

-- RPCs: signed-in users only.
revoke all on function public.dsa_timer_defaults() from public, anon;
revoke all on function public.dsa_get_solution_path(uuid) from public, anon;
revoke all on function public.dsa_get_revealed_path(uuid) from public, anon;
revoke all on function public.dsa_get_my_secret(uuid) from public, anon;
revoke all on function public.dsa_tireur_ready(uuid) from public, anon;
revoke all on function public.dsa_redraw_secret(uuid) from public, anon;
revoke all on function public.dsa_check_time(uuid) from public, anon;
revoke all on function public.dsa_ask(uuid) from public, anon;
revoke all on function public.dsa_answer(uuid, text) from public, anon;
revoke all on function public.dsa_guess(uuid, text) from public, anon;
revoke all on function public.dsa_confirm_guess(uuid, text) from public, anon;
revoke all on function public.dsa_go_back(uuid, integer) from public, anon;
revoke all on function public.dsa_rewind(uuid, integer) from public, anon;
revoke all on function public.dsa_ai_decouvreur_step(uuid) from public, anon;
revoke all on function public.dsa_abandon(uuid) from public, anon;
revoke all on function public.dsa_rematch(uuid, boolean) from public, anon;

grant execute on function public.dsa_timer_defaults() to authenticated;
grant execute on function public.dsa_get_solution_path(uuid) to authenticated;
grant execute on function public.dsa_get_revealed_path(uuid) to authenticated;
grant execute on function public.dsa_get_my_secret(uuid) to authenticated;
grant execute on function public.dsa_tireur_ready(uuid) to authenticated;
grant execute on function public.dsa_redraw_secret(uuid) to authenticated;
grant execute on function public.dsa_check_time(uuid) to authenticated;
grant execute on function public.dsa_ask(uuid) to authenticated;
grant execute on function public.dsa_answer(uuid, text) to authenticated;
grant execute on function public.dsa_guess(uuid, text) to authenticated;
grant execute on function public.dsa_confirm_guess(uuid, text) to authenticated;
grant execute on function public.dsa_go_back(uuid, integer) to authenticated;
grant execute on function public.dsa_rewind(uuid, integer) to authenticated;
grant execute on function public.dsa_ai_decouvreur_step(uuid) to authenticated;
grant execute on function public.dsa_abandon(uuid) to authenticated;
grant execute on function public.dsa_rematch(uuid, boolean) to authenticated;
