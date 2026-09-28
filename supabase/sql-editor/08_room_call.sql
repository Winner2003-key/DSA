-- =============================================================================
-- DSA — 08_room_call.sql — UPGRADE: a room in Voix mode is a live call (brief S7c)
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * For a project that already ran 00, 01 and 07_rules_scope.sql. A new project
--   runs the regenerated 00_all_migrations.sql instead, which already contains this.
-- * Safe to run more than once.
-- * Expected result: "Success. No rows returned". Then run 90_tests.sql:
--   one row, ALL DSA TESTS PASSED.
-- * After it, the four call settings can be changed in the admin app under
--   Réglages, and the `livekit-token` Edge Function can be deployed (VOICE.md).
--
-- Same content as supabase/migrations/0011_room_call.sql (keep them identical).
-- =============================================================================

-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0011_room_call.sql — a room in Voix mode is a live call
--                      (GAME_RULES.md "Voix in a room is a call" and "Call
--                       limits", GRAPH_SPECIFICATION.md §8, brief S7c)
--
-- Re-runnable. Requires 0001–0006, 0008, 0009 and 0010 (0007 is independent).
--
--   1. app_settings                  + the four call settings, admin-editable
--      dsa_app_settings              returns them too (return type changed)
--      dsa_normalize_settings        copies call_max_seconds into a VOICE game
--   2. call_usage                    minutes played, per player and per game
--      dsa_call_day_start            midnight in call_day_timezone
--      dsa_call_seconds_today        one player's seconds since that midnight
--      dsa_call_month_minutes        the whole app's minutes this month
--      dsa_call_minutes_left         one player's minutes left today
--      dsa_call_allowance            RPC for the lobby and the Voix choice
--      dsa_call_assert_allowed       the start-of-game refusal
--      dsa_call_charge               trigger: charge both players at the end
--   3. game_sessions.call_started_at / call_ends_at
--      dsa_end_thinking              starts the call clock with the game
--      dsa_tick                      ends the game at call_ends_at
--      dsa_state_json                + call_started_at, call_ends_at
--      dsa_get_revealed_path         + end_event, so the result screen can say
--                                      « Pas trouvé » / « Temps d'appel écoulé »
--   4. dsa_declare_result            TIREUR: « Trouvé » / « Pas trouvé »
--      dsa_create_session / dsa_join_session / dsa_tireur_ready / dsa_rematch
--                                    refuse a call only at the start
--   5. privileges
--
-- Two clocks, never three. A call game may have the game timer as well, and
-- whichever deadline comes first ends the game; nothing else ever cuts a call.
-- The limits are checked when a call game starts — creating or joining the room,
-- the end of Tireur-ready, and the next name — because players open the app
-- often and a game that is already running must be allowed to finish.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Prerequisite: the rules-and-practice update (0010 / 07_rules_scope.sql)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_list_sections(text)') is null then
    raise exception 'DSA SETUP: this project predates the rules-and-practice update; run 07_rules_scope.sql first, then this file again';
  end if;
end;
$$;


-- #############################################################################
-- 1. The call settings (admin "Réglages")
-- #############################################################################
-- A normal game takes about two minutes; a call costs minutes at the provider.
-- The defaults: 5 min per call, 40 min per player per day, and a monthly budget
-- of 4 500 min = 90 % of LiveKit's free 5 000 (each phone counts as one).
alter table public.app_settings
  add column if not exists call_max_seconds              integer not null default 300,
  add column if not exists call_daily_minutes_per_player integer not null default 40,
  add column if not exists call_monthly_budget_minutes   integer not null default 4500,
  add column if not exists call_day_timezone             text    not null default 'UTC';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_call_max_seconds_check' and conrelid = 'public.app_settings'::regclass) then
    alter table public.app_settings add constraint app_settings_call_max_seconds_check check (call_max_seconds between 30 and 3600);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_call_daily_minutes_check' and conrelid = 'public.app_settings'::regclass) then
    alter table public.app_settings add constraint app_settings_call_daily_minutes_check check (call_daily_minutes_per_player between 0 and 1440);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_call_budget_check' and conrelid = 'public.app_settings'::regclass) then
    alter table public.app_settings add constraint app_settings_call_budget_check check (call_monthly_budget_minutes between 0 and 1000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_call_day_timezone_check' and conrelid = 'public.app_settings'::regclass) then
    alter table public.app_settings add constraint app_settings_call_day_timezone_check check (btrim(call_day_timezone) <> '' and length(call_day_timezone) <= 60);
  end if;
end;
$$;

-- The return type grows, so the old function has to go first. Nothing depends on
-- it at the catalogue level: every caller is a plpgsql body resolved at runtime.
drop function if exists public.dsa_app_settings();

create or replace function public.dsa_app_settings()
returns table (
  think_seconds                 integer,
  play_seconds                  integer,
  max_redraws                   integer,
  call_max_seconds              integer,
  call_daily_minutes_per_player integer,
  call_monthly_budget_minutes   integer,
  call_day_timezone             text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(max(a.think_seconds), 40)::integer,
         coalesce(max(a.play_seconds), 120)::integer,
         coalesce(max(a.max_redraws), 2)::integer,
         coalesce(max(a.call_max_seconds), 300)::integer,
         coalesce(max(a.call_daily_minutes_per_player), 40)::integer,
         coalesce(max(a.call_monthly_budget_minutes), 4500)::integer,
         coalesce(max(a.call_day_timezone), 'UTC')::text
  from public.app_settings a;
$$;


-- A room played with Voix is a call: no question is transcribed, and the Tireur
-- ends the game. Every call rule below asks this one question.
create or replace function public.dsa_is_call(p_session public.game_sessions)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_session.mode = 'HUMAN_VS_HUMAN' and p_session.settings->>'input_mode' = 'VOICE', false);
$$;


-- Settings, as 0010 left them, plus the length of a call. A game keeps the
-- value it was created with, so the admin never shortens a call being played.
create or replace function public.dsa_normalize_settings(p_settings jsonb, p_graph_id uuid)
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
  v_scope    jsonb;
  v_on       boolean;
  v_ids      uuid[];
  v_bad      text;
  v_app      record;
  v_out      jsonb;
begin
  if jsonb_typeof(v_settings) <> 'object' then
    raise exception 'DSA_INVALID_SETTINGS: settings must be a JSON object (got %)', jsonb_typeof(v_settings);
  end if;

  select string_agg(k, ', ' order by k) into v_unknown
  from jsonb_object_keys(v_settings) as k
  where k not in ('input_mode', 'timed', 'scope');

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

  -- scope: section node ids. Absent, null or empty means the whole book.
  v_scope := v_settings->'scope';
  if v_scope is null or v_scope = 'null'::jsonb then
    v_scope := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_scope) <> 'array' then
    raise exception 'DSA_INVALID_SETTINGS: scope must be an array of section ids (got %)', jsonb_typeof(v_scope);
  end if;

  begin
    select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_ids
    from jsonb_array_elements_text(v_scope);
  exception when invalid_text_representation then
    raise exception 'DSA_INVALID_SETTINGS: scope must contain section ids (uuids)';
  end;

  if cardinality(v_ids) > 0 then
    -- Every id must be a section of THIS graph: approved, not a name, reachable.
    select string_agg(x::text, ', ' order by x::text) into v_bad
    from unnest(v_ids) as x
    where not exists (
      select 1 from public.dsa_sections(p_graph_id) s where s.node_id = x
    );

    if v_bad is not null then
      raise exception 'DSA_INVALID_SETTINGS: scope has unknown section(s): %', v_bad;
    end if;

    if not exists (select 1 from public.dsa_scope_characters(p_graph_id, v_ids)) then
      raise exception 'DSA_NO_PLAYABLE_SECRET: the chosen part of the book has no playable name';
    end if;
  end if;

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

  -- Only a room uses it, but input_mode is all this function knows; carrying it
  -- in a solo VOICE game's settings costs nothing and is never read there.
  if (v_mode #>> '{}') = 'VOICE' then
    v_out := v_out || jsonb_build_object('call_max_seconds', v_app.call_max_seconds);
  end if;

  -- The whole book stays the absence of the key, so an untouched game's settings
  -- keep exactly the shape they had before this migration.
  if cardinality(v_ids) > 0 then
    v_out := v_out || jsonb_build_object('scope', to_jsonb(v_ids));
  end if;

  return v_out;
end;
$$;


-- #############################################################################
-- 2. Usage and allowances
-- #############################################################################
-- One row per player per call game, written when the game ends. A player reads
-- their own rows (the app never needs to, but there is nothing secret in them);
-- only the trigger below writes.
create table if not exists public.call_usage (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  started_at      timestamptz not null,
  seconds         integer not null,
  created_at      timestamptz not null default now(),
  constraint call_usage_seconds_check check (seconds >= 0),
  constraint call_usage_once unique (user_id, game_session_id)
);

create index if not exists call_usage_user_started_idx on public.call_usage (user_id, started_at);
create index if not exists call_usage_started_idx on public.call_usage (started_at);

alter table public.call_usage enable row level security;

revoke all on table public.call_usage from public, anon, authenticated;
grant select on table public.call_usage to authenticated;
grant all on table public.call_usage to service_role;

drop policy if exists call_usage_own_select on public.call_usage;
create policy call_usage_own_select on public.call_usage
  for select to authenticated
  using (user_id = auth.uid());


-- Midnight in the admin's timezone. A timezone the admin mistyped must not take
-- calls down, so anything Postgres rejects falls back to UTC.
create or replace function public.dsa_call_day_start(p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce(nullif(btrim(p_tz), ''), 'UTC');
begin
  return date_trunc('day', now() at time zone v_tz) at time zone v_tz;
exception when others then
  return date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
end;
$$;

-- The same, for the first day of the month: the monthly budget's window.
create or replace function public.dsa_call_month_start(p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce(nullif(btrim(p_tz), ''), 'UTC');
begin
  return date_trunc('month', now() at time zone v_tz) at time zone v_tz;
exception when others then
  return date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
end;
$$;

-- Seconds this player has already spent on calls today. Only minutes played
-- count: a row exists only once a game has ended.
create or replace function public.dsa_call_seconds_today(p_uid uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app   record;
  v_since timestamptz;
  v_total bigint;
begin
  if p_uid is null then
    return 0;
  end if;
  select * into v_app from public.dsa_app_settings();
  v_since := public.dsa_call_day_start(v_app.call_day_timezone);

  select coalesce(sum(u.seconds), 0) into v_total
  from public.call_usage u
  where u.user_id = p_uid and u.started_at >= v_since;

  return least(v_total, 2147483647)::integer;
end;
$$;

-- What this player has left today, in whole minutes. Under one minute means Voix
-- is not offered in a room until the day resets.
create or replace function public.dsa_call_minutes_left(p_uid uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app  record;
  v_used integer;
begin
  select * into v_app from public.dsa_app_settings();
  v_used := public.dsa_call_seconds_today(p_uid);
  return greatest(0, (v_app.call_daily_minutes_per_player * 60 - v_used) / 60)::integer;
end;
$$;

-- The whole app's call minutes this month, both phones of every game counted.
create or replace function public.dsa_call_month_minutes()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app   record;
  v_since timestamptz;
  v_total bigint;
begin
  select * into v_app from public.dsa_app_settings();
  v_since := public.dsa_call_month_start(v_app.call_day_timezone);

  select coalesce(sum(u.seconds), 0) into v_total
  from public.call_usage u
  where u.started_at >= v_since;

  return least(v_total / 60, 2147483647)::integer;
end;
$$;

-- dsa_call_allowance -> {minutes_left_today, daily_minutes, max_seconds, available}.
-- Any player. What the lobby and the Voix choice say before a game starts, so no
-- number is ever hard-coded in the app.
create or replace function public.dsa_call_allowance()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_app record;
begin
  if v_uid is null then
    raise exception 'DSA_NOT_AUTHENTICATED: sign in first (anonymous sign-in is fine)';
  end if;
  select * into v_app from public.dsa_app_settings();

  return jsonb_build_object(
    'minutes_left_today', public.dsa_call_minutes_left(v_uid),
    'daily_minutes', v_app.call_daily_minutes_per_player,
    'max_seconds', v_app.call_max_seconds,
    -- The monthly budget is the app's, not this player's: when it is gone, no
    -- new call starts for anyone, and Boutons still works.
    'available', public.dsa_call_month_minutes() < v_app.call_monthly_budget_minutes
  );
end;
$$;

-- Raises when this player may not START a call. Never called for a running game.
create or replace function public.dsa_call_assert_allowed(p_uid uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app record;
begin
  select * into v_app from public.dsa_app_settings();

  if public.dsa_call_month_minutes() >= v_app.call_monthly_budget_minutes then
    raise exception 'DSA_CALL_BUDGET_EXHAUSTED: the monthly call budget is used up; play with Boutons';
  end if;

  if public.dsa_call_minutes_left(p_uid) < 1 then
    raise exception 'DSA_CALL_DAILY_LIMIT: this player has no call minutes left today; play with Boutons';
  end if;
end;
$$;

-- Both phones of a room, for the moment the call is about to open.
create or replace function public.dsa_call_assert_allowed_session(p_session_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_player record;
begin
  for v_player in
    select distinct p.user_id
    from public.game_players p
    where p.game_session_id = p_session_id and p.user_id is not null and not p.is_ai
  loop
    perform public.dsa_call_assert_allowed(v_player.user_id);
  end loop;
end;
$$;

-- The game is over: charge both players for the call, once. Every ending goes
-- through a status change, so one trigger covers Trouvé, Pas trouvé, the timer,
-- the call clock and abandoning.
create or replace function public.dsa_call_charge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stop timestamptz;
begin
  if new.call_started_at is null
     or old.status <> 'PLAYING'
     or new.status not in ('DISCOVERED', 'ABANDONED', 'TIME_UP') then
    return new;
  end if;

  v_stop := least(coalesce(new.ended_at, now()), coalesce(new.call_ends_at, coalesce(new.ended_at, now())));

  insert into public.call_usage (user_id, game_session_id, started_at, seconds)
  select distinct p.user_id,
         new.id,
         new.call_started_at,
         greatest(0, round(extract(epoch from v_stop - new.call_started_at)))::integer
  from public.game_players p
  where p.game_session_id = new.id and p.user_id is not null and not p.is_ai
  on conflict (user_id, game_session_id) do nothing;

  return new;
end;
$$;

drop trigger if exists game_sessions_call_charge on public.game_sessions;
create trigger game_sessions_call_charge
  after update of status on public.game_sessions
  for each row execute function public.dsa_call_charge();


-- #############################################################################
-- 3. The call clock
-- #############################################################################
alter table public.game_sessions
  add column if not exists call_started_at timestamptz,
  add column if not exists call_ends_at    timestamptz;

-- Ends the preparation phase, as 0009 did — and, in a room played with Voix,
-- this is also the moment the call opens, so its own deadline is fixed here:
-- at most call_max_seconds, less if either player has fewer minutes left today.
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
  v_call    integer := null;
  v_left    integer;
begin
  if v_session.id is null or v_session.tireur_ready_at is not null then
    return v_session;
  end if;

  select * into v_app from public.dsa_app_settings();
  v_play := coalesce(nullif(v_session.settings->>'play_seconds', '')::integer, v_app.play_seconds);

  if public.dsa_is_call(v_session) then
    select coalesce(min(public.dsa_call_minutes_left(p.user_id)), 0) * 60 into v_left
    from public.game_players p
    where p.game_session_id = v_session.id and p.user_id is not null and not p.is_ai;

    v_call := least(
      coalesce(nullif(v_session.settings->>'call_max_seconds', '')::integer, v_app.call_max_seconds),
      greatest(coalesce(v_left, 0), 0)
    );
  end if;

  update public.game_sessions s
  set tireur_ready_at = p_at,
      -- Keep the field meaningful: it is now "when the thinking ended".
      think_ends_at = case when s.think_ends_at is null then null else p_at end,
      play_ends_at = case
        when coalesce(s.settings->>'timed', 'false') = 'true' then p_at + make_interval(secs => v_play)
        else s.play_ends_at
      end,
      call_started_at = case when v_call is null then s.call_started_at else p_at end,
      call_ends_at = case when v_call is null then s.call_ends_at else p_at + make_interval(secs => v_call) end
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

-- The clock, as 0009 wrote it, plus the call's own deadline. A call game may
-- also be timed: the earlier of the two ends it, and the game timer wins a tie.
create or replace function public.dsa_tick(p_session public.game_sessions)
returns public.game_sessions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session  public.game_sessions%rowtype := p_session;
  v_now      timestamptz := now();
  v_timed    boolean;
  v_deadline timestamptz := null;
  v_event    text := 'TIME_UP';
begin
  if v_session.id is null or v_session.status <> 'PLAYING' then
    return v_session;
  end if;

  v_timed := coalesce(v_session.settings->>'timed', 'false') = 'true';

  -- The thinking time ran out: the preparation phase ends at its own deadline,
  -- so the game time is the same length however long the Tireur actually took.
  -- (This is also where a call's deadline is set, from the same instant.)
  if v_timed
     and v_session.tireur_ready_at is null
     and v_session.think_ends_at is not null
     and v_now >= v_session.think_ends_at then
    v_session := public.dsa_end_thinking(v_session, v_session.think_ends_at, 'DEADLINE');
  end if;

  if v_timed and v_session.play_ends_at is not null then
    v_deadline := v_session.play_ends_at;
    v_event := 'TIME_UP';
  end if;

  -- « Temps d'appel écoulé », unless the game timer runs out first or together.
  if v_session.call_ends_at is not null and (v_deadline is null or v_session.call_ends_at < v_deadline) then
    v_deadline := v_session.call_ends_at;
    v_event := 'CALL_TIME_UP';
  end if;

  if v_deadline is not null and v_now >= v_deadline then
    update public.game_sessions s
    set status = 'TIME_UP',
        awaiting = 'NONE',
        winner = null,
        ended_at = v_deadline,
        pending_prompt_node_id = null,
        pending_guess = null
    where s.id = v_session.id
    returning * into v_session;

    insert into public.game_moves (game_session_id, move_type, actor_role, payload)
    values (v_session.id, 'SYSTEM', 'SYSTEM', jsonb_build_object('event', v_event));
  end if;

  return v_session;
end;
$$;

-- State JSON, as 0010 left it, plus the call's two instants. The app needs them
-- to hang up by itself at the end and to warn a minute before.
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
  v_scope     uuid[];
  v_labels    jsonb;
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

  v_scope := public.dsa_settings_scope(v_session.settings);
  if cardinality(v_scope) = 0 then
    v_labels := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(s.label order by s.depth, s.label), '[]'::jsonb) into v_labels
    from public.dsa_sections(v_session.graph_id) s
    where s.node_id = any (v_scope);
  end if;

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
    'redraws_left', greatest(0, v_max - v_used),
    'scope_labels', v_labels,
    'call_started_at', v_session.call_started_at,
    'call_ends_at', v_session.call_ends_at
  );
end;
$$;

-- The revealed path, as 0009 left it, plus how the game ended: the result screen
-- says « Pas trouvé » for NOT_FOUND and « Temps d'appel écoulé » for
-- CALL_TIME_UP, where a game with questions would show its statistics.
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
  v_event   text := null;
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

    select m.payload->>'event' into v_event
    from public.game_moves m
    where m.game_session_id = p_session_id
      and m.move_type = 'SYSTEM'
      and m.payload->>'event' in ('FOUND', 'NOT_FOUND', 'CALL_TIME_UP', 'TIME_UP', 'ABANDONED')
    order by m.seq desc
    limit 1;
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
    'secret', v_secret,
    'end_event', v_event
  );
end;
$$;


-- #############################################################################
-- 4. The Tireur ends a call game, and where a call may be refused
-- #############################################################################
-- dsa_declare_result(p_session_id, p_found) -> state. TIREUR, in a room played
-- with Voix only. The app followed no question, so the Tireur says how it ended:
-- « Trouvé » is an ordinary discovery, « Pas trouvé » stops the game.
create or replace function public.dsa_declare_result(p_session_id uuid, p_found boolean)
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

  if not public.dsa_is_call(v_session) then
    raise exception 'DSA_WRONG_MODE: only a room played with Voix ends this way';
  end if;
  if v_session.status <> 'PLAYING' then
    raise exception 'DSA_WAITING_FOR_PLAYER: the other player has not joined yet';
  end if;
  if v_session.tireur_ready_at is null then
    raise exception 'DSA_TIREUR_NOT_READY: the call has not started yet';
  end if;
  if p_found is null then
    raise exception 'DSA_INVALID_SETTINGS: say whether the name was found';
  end if;

  if p_found then
    update public.game_sessions s
    set status = 'DISCOVERED',
        winner = 'DECOUVREUR',
        awaiting = 'NONE',
        ended_at = now(),
        pending_prompt_node_id = null,
        pending_guess = null
    where s.id = p_session_id;
  else
    update public.game_sessions s
    set status = 'ABANDONED',
        winner = null,
        awaiting = 'NONE',
        ended_at = now(),
        pending_prompt_node_id = null,
        pending_guess = null
    where s.id = p_session_id;
  end if;

  insert into public.game_moves (game_session_id, move_type, actor_role, actor_user_id, payload)
  values (
    p_session_id, 'SYSTEM', 'TIREUR', auth.uid(),
    jsonb_build_object('event', case when p_found then 'FOUND' else 'NOT_FOUND' end, 'by_role', 'TIREUR')
  );

  return public.dsa_state_json(p_session_id);
end;
$$;


-- Creation, as 0010 left it, refusing a call the caller may not start.
create or replace function public.dsa_create_session(
  p_graph_slug   text,
  p_mode         text,
  p_role         text default null,
  p_display_name text default null,
  p_settings     jsonb default '{}'::jsonb
)
returns table (session_id uuid, room_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid      uuid := auth.uid();
  v_mode     text := upper(btrim(coalesce(p_mode, '')));
  v_role     text := nullif(upper(btrim(coalesce(p_role, ''))), '');
  v_settings jsonb;
  v_graph_id uuid;
begin
  if v_uid is null then
    raise exception 'DSA_NOT_AUTHENTICATED: sign in first (anonymous sign-in is fine)';
  end if;

  if v_mode is null or v_mode not in ('HUMAN_VS_HUMAN', 'AI_TIREUR', 'AI_DECOUVREUR', 'LOCAL') then
    raise exception 'DSA_INVALID_MODE: mode must be HUMAN_VS_HUMAN, AI_TIREUR, AI_DECOUVREUR or LOCAL (got %)', p_mode;
  end if;

  if v_mode = 'HUMAN_VS_HUMAN' then
    if v_role is null or v_role not in ('TIREUR', 'DECOUVREUR') then
      raise exception 'DSA_INVALID_ROLE: choose TIREUR or DECOUVREUR (got %)', p_role;
    end if;
  elsif v_mode = 'AI_TIREUR' then
    if v_role is not null and v_role <> 'DECOUVREUR' then
      raise exception 'DSA_INVALID_ROLE: in AI_TIREUR mode you are the DECOUVREUR (got %)', p_role;
    end if;
    v_role := 'DECOUVREUR';
  elsif v_mode = 'AI_DECOUVREUR' then
    if v_role is not null and v_role <> 'TIREUR' then
      raise exception 'DSA_INVALID_ROLE: in AI_DECOUVREUR mode you are the TIREUR (got %)', p_role;
    end if;
    v_role := 'TIREUR';
  else
    v_role := null;  -- LOCAL: both roles
  end if;

  v_graph_id := public.dsa_graph_for_play(p_graph_slug);
  v_settings := public.dsa_normalize_settings(p_settings, v_graph_id);

  -- A room played with Voix is a call: check this phone's allowance before the
  -- room exists, so the refusal lands on "Créer la partie" and not mid-game.
  if v_mode = 'HUMAN_VS_HUMAN' and v_settings->>'input_mode' = 'VOICE' then
    perform public.dsa_call_assert_allowed(v_uid);
  end if;

  perform public.dsa_cleanup_stale_sessions();

  return query
    select n.session_id, n.room_code
    from public.dsa_new_session(
      v_uid, v_graph_id, v_mode, v_role, nullif(btrim(p_display_name), ''), v_settings, null
    ) n;
end;
$$;


-- Joining, as 0008 left it, refusing a call this phone may not start.
create or replace function public.dsa_join_session(p_room_code text, p_display_name text default null)
returns table (session_id uuid, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid       uuid := auth.uid();
  v_code      text := upper(regexp_replace(coalesce(p_room_code, ''), '\s+', '', 'g'));
  v_session   public.game_sessions%rowtype;
  v_existing  text;
  v_free_role text;
begin
  if v_uid is null then
    raise exception 'DSA_NOT_AUTHENTICATED: sign in first (anonymous sign-in is fine)';
  end if;

  if v_code ~ '^[0-9]{4}$' then
    v_code := 'DSA-' || v_code;
  elsif v_code ~ '^DSA[0-9]{4}$' then
    v_code := 'DSA-' || substr(v_code, 4);
  end if;

  perform public.dsa_cleanup_stale_sessions();

  select * into v_session
  from public.game_sessions s
  where s.room_code = v_code
    and s.status in ('WAITING', 'READY', 'PLAYING')
  order by s.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'DSA_ROOM_NOT_FOUND: no open room with code %', v_code;
  end if;

  select p.role into v_existing
  from public.game_players p
  where p.game_session_id = v_session.id
    and p.user_id = v_uid
  order by case p.role when 'TIREUR' then 0 else 1 end
  limit 1;

  if v_existing is not null then
    session_id := v_session.id;
    role := v_existing;
    return next;
    return;
  end if;

  select r.role_name into v_free_role
  from (values ('TIREUR', 0), ('DECOUVREUR', 1)) as r (role_name, sort_order)
  where not exists (
    select 1 from public.game_players p
    where p.game_session_id = v_session.id and p.role = r.role_name
  )
  order by r.sort_order
  limit 1;

  if v_free_role is null or v_session.mode <> 'HUMAN_VS_HUMAN' then
    raise exception 'DSA_ROOM_FULL: this room already has its players';
  end if;

  -- Before taking the seat: this phone must have call minutes for a Voix room.
  if public.dsa_is_call(v_session) then
    perform public.dsa_call_assert_allowed(v_uid);
  end if;

  insert into public.game_players (game_session_id, user_id, role, display_name)
  values (v_session.id, v_uid, v_free_role, nullif(btrim(p_display_name), ''));

  if v_session.status = 'WAITING' then
    perform public.dsa_start_play(v_session.id);
  end if;

  session_id := v_session.id;
  role := v_free_role;
  return next;
end;
$$;


-- "Je suis prêt", as 0009 left it. In a room played with Voix this is the last
-- moment a call can be refused: after it, only its own deadline ends the game.
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
    if public.dsa_is_call(v_session) then
      perform public.dsa_call_assert_allowed_session(p_session_id);
    end if;
    v_session := public.dsa_end_thinking(v_session, now(), 'READY');
  end if;

  return public.dsa_state_json(p_session_id);
end;
$$;


-- "Nom suivant", as 0010 left it, refusing a next call this phone cannot start.
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
  v_graph_id  uuid;
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

  -- The next name keeps the settings, so a call game starts another call.
  if public.dsa_is_call(v_old) then
    perform public.dsa_call_assert_allowed(v_uid);
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

  v_graph_id := public.dsa_graph_for_play((select g.slug from public.graphs g where g.id = v_old.graph_id));

  select * into v_created
  from public.dsa_new_session(
    v_uid,
    v_graph_id,
    'HUMAN_VS_HUMAN',
    v_role,
    v_me.display_name,
    public.dsa_normalize_settings(
      jsonb_build_object(
        'input_mode', coalesce(v_old.settings->>'input_mode', 'BUTTONS'),
        'timed', coalesce((v_old.settings->>'timed')::boolean, false),
        'scope', coalesce(v_old.settings->'scope', '[]'::jsonb)
      ),
      v_graph_id
    ),
    p_session_id
  );

  session_id := v_created.session_id;
  room_code := v_created.room_code;
  role := v_role;
  return next;
end;
$$;


-- #############################################################################
-- 5. Privileges (Supabase grants EXECUTE to anon/authenticated by default)
-- #############################################################################
-- Internal: owner only.
revoke all on function public.dsa_app_settings() from public, anon, authenticated;
revoke all on function public.dsa_is_call(public.game_sessions) from public, anon, authenticated;
revoke all on function public.dsa_normalize_settings(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.dsa_call_day_start(text) from public, anon, authenticated;
revoke all on function public.dsa_call_month_start(text) from public, anon, authenticated;
revoke all on function public.dsa_call_seconds_today(uuid) from public, anon, authenticated;
revoke all on function public.dsa_call_minutes_left(uuid) from public, anon, authenticated;
revoke all on function public.dsa_call_month_minutes() from public, anon, authenticated;
revoke all on function public.dsa_call_assert_allowed(uuid) from public, anon, authenticated;
revoke all on function public.dsa_call_assert_allowed_session(uuid) from public, anon, authenticated;
revoke all on function public.dsa_call_charge() from public, anon, authenticated;
revoke all on function public.dsa_end_thinking(public.game_sessions, timestamptz, text) from public, anon, authenticated;
revoke all on function public.dsa_tick(public.game_sessions) from public, anon, authenticated;
revoke all on function public.dsa_state_json(uuid) from public, anon, authenticated;

-- RPCs: signed-in users only.
revoke all on function public.dsa_call_allowance() from public, anon;
revoke all on function public.dsa_declare_result(uuid, boolean) from public, anon;
revoke all on function public.dsa_get_revealed_path(uuid) from public, anon;
revoke all on function public.dsa_create_session(text, text, text, text, jsonb) from public, anon;
revoke all on function public.dsa_join_session(text, text) from public, anon;
revoke all on function public.dsa_tireur_ready(uuid) from public, anon;
revoke all on function public.dsa_rematch(uuid, boolean) from public, anon;

grant execute on function public.dsa_call_allowance() to authenticated;
grant execute on function public.dsa_declare_result(uuid, boolean) to authenticated;
grant execute on function public.dsa_get_revealed_path(uuid) to authenticated;
grant execute on function public.dsa_create_session(text, text, text, text, jsonb) to authenticated;
grant execute on function public.dsa_join_session(text, text) to authenticated;
grant execute on function public.dsa_tireur_ready(uuid) to authenticated;
grant execute on function public.dsa_rematch(uuid, boolean) to authenticated;
