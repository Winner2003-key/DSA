-- =============================================================================
-- DSA — 05_rooms.sql — UPGRADE: rooms on two devices (brief S6)
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * For a project that already ran 00 and 01 (and 03_game_ux.sql if it needed
--   it). A new project runs the regenerated 00_all_migrations.sql instead,
--   which already contains this change.
-- * Safe to run more than once.
-- * Expected result: "Success. No rows returned". Then run 90_tests.sql:
--   one row, ALL DSA TESTS PASSED.
--
-- Same content as supabase/migrations/0008_rooms.sql (keep them identical).
-- =============================================================================

-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0008_rooms.sql — rooms on two devices (brief S6)
--
-- Re-runnable. Requires 0001–0006 (0007 is independent).
--
--   1. game_sessions.tireur_ready_at   the "Tireur first" phase, on the server
--      game_sessions.rematch_of        a room created by "Rejouer" from another
--      index on open sessions by updated_at (stale-room cleanup)
--   2. dsa_cleanup_stale_sessions(p_idle)   internal: idle open sessions → ABANDONED
--   3. dsa_new_session(...)                 internal: the body of session creation
--   4. dsa_create_session                   + cleanup, + tireur_ready_at for non-HvH
--   5. dsa_join_session                     + cleanup
--   6. dsa_tireur_ready(p_session_id)       RPC, TIREUR: "Je suis prêt"
--   7. dsa_ask / dsa_guess                  DSA_TIREUR_NOT_READY in HUMAN_VS_HUMAN
--   8. dsa_state_json                       + tireur_ready, room_code
--   9. dsa_rematch(p_session_id, p_swap_roles)   RPC: "Rejouer" for a finished room
--  10. privileges
--
-- The Tireur-ready phase is the one place GRAPH_SPECIFICATION §9's thinking
-- time will live: a timed-games migration sets think_ends_at next to
-- tireur_ready_at and ends the phase on the deadline as well as on the button.
--
-- Optional scheduled cleanup (the owner adds it; nothing here needs it):
-- Dashboard → Integrations → Cron → enable pg_cron → Create job:
--   name     dsa-cleanup-stale-sessions
--   schedule 17 * * * *            (every hour, at minute 17)
--   command  select public.dsa_cleanup_stale_sessions();
-- or in the SQL Editor, once pg_cron is enabled:
--   select cron.schedule('dsa-cleanup-stale-sessions', '17 * * * *',
--                        $cron$select public.dsa_cleanup_stale_sessions()$cron$);
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Prerequisite: the game UX update (0006 / 03_game_ux.sql)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_normalize_settings(jsonb)') is null then
    raise exception 'DSA SETUP: this project predates the game UX update; run 03_game_ux.sql first, then this file again';
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 1. Columns and index
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'game_sessions' and column_name = 'tireur_ready_at'
  ) then
    alter table public.game_sessions add column tireur_ready_at timestamptz;
    -- Only on the first run: sessions that already started keep playing
    -- (a room that is already PLAYING is past the Tireur's card).
    update public.game_sessions s
    set tireur_ready_at = coalesce(s.started_at, s.created_at)
    where s.status <> 'WAITING';
  end if;
end;
$$;

alter table public.game_sessions
  add column if not exists rematch_of uuid references public.game_sessions (id) on delete set null;

create index if not exists game_sessions_rematch_of_idx
  on public.game_sessions (rematch_of)
  where rematch_of is not null;

-- Every transition updates the session row (trigger game_sessions_set_updated_at),
-- so updated_at is the time of the last activity.
create index if not exists game_sessions_open_updated_at_idx
  on public.game_sessions (updated_at)
  where status in ('WAITING', 'READY', 'PLAYING');


-- -----------------------------------------------------------------------------
-- 2. Stale rooms: open sessions with no activity for p_idle → ABANDONED.
--    Internal (not granted to clients). Finished sessions are never touched.
--    Cheap: the partial index above, at most 500 rows per call, and rows another
--    transaction is using are skipped rather than waited for.
--    Returns the number of sessions it closed.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_cleanup_stale_sessions(p_idle interval default interval '6 hours')
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_idle  interval := coalesce(p_idle, interval '6 hours');
  v_count integer;
begin
  if v_idle < interval '1 minute' then
    raise exception 'DSA_INVALID_IDLE: the idle time must be at least 1 minute (got %)', v_idle;
  end if;

  with stale as (
    select s.id
    from public.game_sessions s
    where s.status in ('WAITING', 'READY', 'PLAYING')
      and s.updated_at < now() - v_idle
    order by s.updated_at
    limit 500
    for update skip locked
  ),
  closed as (
    update public.game_sessions s
    set status = 'ABANDONED',
        awaiting = 'NONE',
        ended_at = now(),
        pending_prompt_node_id = null,
        pending_guess = null
    from stale
    where s.id = stale.id
    returning s.id
  ),
  logged as (
    insert into public.game_moves (game_session_id, move_type, actor_role, payload)
    select closed.id, 'SYSTEM', 'SYSTEM', jsonb_build_object('event', 'ABANDONED', 'reason', 'IDLE')
    from closed
    returning 1
  )
  select count(*) into v_count from logged;

  return v_count;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. dsa_new_session: creates a session for p_uid (no validation of the mode
--    and role: callers do it). Non-HvH sessions start PLAYING with the Tireur
--    already ready; a HUMAN_VS_HUMAN room waits for its second player.
-- -----------------------------------------------------------------------------
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
        case when p_mode <> 'HUMAN_VS_HUMAN' then now() end
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


-- -----------------------------------------------------------------------------
-- 4. dsa_create_session: same signature and checks as 0006; cleans up stale
--    rooms first, then delegates to dsa_new_session.
-- -----------------------------------------------------------------------------
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
  v_mode     text := upper(btrim(p_mode));
  v_role     text := nullif(upper(btrim(p_role)), '');
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

  v_settings := public.dsa_normalize_settings(p_settings);
  v_graph_id := public.dsa_graph_for_play(p_graph_slug);

  perform public.dsa_cleanup_stale_sessions();

  return query
    select n.session_id, n.room_code
    from public.dsa_new_session(
      v_uid, v_graph_id, v_mode, v_role, nullif(btrim(p_display_name), ''), v_settings, null
    ) n;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. dsa_join_session: same as 0003, after cleaning up stale rooms (so a room
--    that went idle is no longer found: DSA_ROOM_NOT_FOUND).
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 6. dsa_tireur_ready -> state. TIREUR. Ends the "Tireur first" phase of a room
--    once both players are there. Calling it again changes nothing. Other modes
--    are ready from creation, so it is a no-op there.
-- -----------------------------------------------------------------------------
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
  perform public.dsa_assert_not_over(v_session);

  if v_session.status <> 'PLAYING' then
    raise exception 'DSA_WAITING_FOR_PLAYER: the other player has not joined yet';
  end if;

  if v_session.tireur_ready_at is null then
    update public.game_sessions s
    set tireur_ready_at = now()
    where s.id = p_session_id;

    insert into public.game_moves (game_session_id, move_type, actor_role, actor_user_id, payload)
    values (p_session_id, 'SYSTEM', 'TIREUR', auth.uid(), jsonb_build_object('event', 'TIREUR_READY'));
  end if;

  return public.dsa_state_json(p_session_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- 7. The Découvreur cannot play before the Tireur is ready (HUMAN_VS_HUMAN).
-- -----------------------------------------------------------------------------
create or replace function public.dsa_assert_tireur_ready(p_session public.game_sessions)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_session.status = 'PLAYING'
     and p_session.mode = 'HUMAN_VS_HUMAN'
     and p_session.tireur_ready_at is null then
    raise exception 'DSA_TIREUR_NOT_READY: the Tireur is still looking at the card';
  end if;
end;
$$;

-- dsa_ask -> state. DÉCOUVREUR. In AI_TIREUR mode the answer is recorded at once.
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

-- dsa_guess -> state. DÉCOUVREUR. AI_TIREUR mode confirms at once.
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
  perform public.dsa_assert_not_over(v_session);
  perform public.dsa_assert_tireur_ready(v_session);
  perform public.dsa_do_guess(p_session_id, p_name, auth.uid(), false);

  if v_session.mode = 'AI_TIREUR' then
    perform public.dsa_do_confirm_guess(p_session_id, public.dsa_ai_tireur_answer(p_session_id), null, true);
  end if;

  return public.dsa_state_json(p_session_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- 8. State JSON: 0006 plus
--    tireur_ready  false only while a room's Tireur has not said "Je suis prêt"
--    room_code     the room's code (players can already read it from
--                  game_sessions; the lobby and the Realtime channel need it)
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
    'room_code', v_session.room_code
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 9. dsa_rematch(p_session_id, p_swap_roles) -> (session_id, room_code, role)
--    "Rejouer" at the end of a room. Only a human player of that finished
--    HUMAN_VS_HUMAN session can call it, so a stranger who learns the room code
--    cannot take a player's seat in the rematch.
--    * First call: a new room on the same graph with the same settings; the
--      caller keeps their role (p_swap_roles = false) or takes the other one.
--    * Later calls (the other player accepting, or both pressing "Rejouer"):
--      join that open rematch and take the free role; p_swap_roles is ignored.
--    The old session row is locked, so two simultaneous calls cannot create
--    two rematches.
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

  if v_old.mode <> 'HUMAN_VS_HUMAN' then
    raise exception 'DSA_WRONG_MODE: only a room between two players can be replayed together';
  end if;
  if v_old.status not in ('DISCOVERED', 'ABANDONED') then
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
    public.dsa_normalize_settings(v_old.settings),
    p_session_id
  );

  session_id := v_created.session_id;
  room_code := v_created.room_code;
  role := v_role;
  return next;
end;
$$;


-- -----------------------------------------------------------------------------
-- 10. Privileges (Supabase grants EXECUTE to anon/authenticated by default)
-- -----------------------------------------------------------------------------
-- Internal: owner only (pg_cron runs as postgres).
revoke all on function public.dsa_cleanup_stale_sessions(interval) from public, anon, authenticated;
revoke all on function public.dsa_new_session(uuid, uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.dsa_assert_tireur_ready(public.game_sessions) from public, anon, authenticated;
revoke all on function public.dsa_state_json(uuid) from public, anon, authenticated;

-- RPCs: signed-in users only.
revoke all on function public.dsa_create_session(text, text, text, text, jsonb) from public, anon;
revoke all on function public.dsa_join_session(text, text) from public, anon;
revoke all on function public.dsa_tireur_ready(uuid) from public, anon;
revoke all on function public.dsa_ask(uuid) from public, anon;
revoke all on function public.dsa_guess(uuid, text) from public, anon;
revoke all on function public.dsa_rematch(uuid, boolean) from public, anon;

grant execute on function public.dsa_create_session(text, text, text, text, jsonb) to authenticated;
grant execute on function public.dsa_join_session(text, text) to authenticated;
grant execute on function public.dsa_tireur_ready(uuid) to authenticated;
grant execute on function public.dsa_ask(uuid) to authenticated;
grant execute on function public.dsa_guess(uuid, text) to authenticated;
grant execute on function public.dsa_rematch(uuid, boolean) to authenticated;
