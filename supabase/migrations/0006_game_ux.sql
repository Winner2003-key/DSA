-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0006_game_ux.sql — game UX iteration (GRAPH_SPECIFICATION.md §8, brief S3b)
--
-- Re-runnable. Requires 0001–0005.
--
--   1. game_sessions.settings jsonb (input_mode VOICE|BUTTONS, default BUTTONS)
--   2. dsa_has_homonyms(node): another reachable person has the same name
--   3. dsa_get_my_secret      + has_homonyms          (return type changes: drop + create)
--   4. dsa_path_json          + prompt_kind, node_type, target_text
--   5. dsa_state_json         + settings
--   6. dsa_game_stats         {questions, non, backs, rewinds}
--   7. dsa_get_revealed_path  + stats, secret.has_homonyms
--   8. dsa_create_session     + p_settings jsonb       (signature changes: drop + create)
--   9. privileges for everything above
--
-- The new path fields only describe what the answer already revealed: the
-- prompt's own kind and type, and (SPINE only) the text of the node the answer
-- entered — which is the next thing the Découvreur is asked about anyway.
-- target_text uses dsa_prompt_text, so a CHARACTER target would show its clue,
-- never its name.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Session settings
-- -----------------------------------------------------------------------------
alter table public.game_sessions
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'game_sessions_settings_check'
      and conrelid = 'public.game_sessions'::regclass
  ) then
    alter table public.game_sessions
      add constraint game_sessions_settings_check check (jsonb_typeof(settings) = 'object');
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. Homonyms: another CHARACTER of the same graph, reachable from START through
--    approved edges, with the same normalized label and a different person
--    (character_id). ABRAHAM and ABRAM are one person; two JACQUES are two.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_has_homonyms(p_node_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.graph_nodes n
    join public.dsa_playable_characters(n.graph_id) p on p.node_id <> n.id
    join public.graph_nodes o on o.id = p.node_id
    where n.id = p_node_id
      and public.dsa_normalize(o.label) = public.dsa_normalize(n.label)
      and (n.character_id is null or o.character_id is null or o.character_id <> n.character_id)
  );
$$;


-- -----------------------------------------------------------------------------
-- 3. dsa_get_my_secret -> (node_id, name, description, has_homonyms). TIREUR only.
--    The description is still returned; clients show it only when has_homonyms.
-- -----------------------------------------------------------------------------
drop function if exists public.dsa_get_my_secret(uuid);

create function public.dsa_get_my_secret(p_session_id uuid)
returns table (node_id uuid, name text, description text, has_homonyms boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform public.dsa_require_player(p_session_id, 'TIREUR', false);

  return query
    select n.id, n.label, coalesce(c.description, n.description), public.dsa_has_homonyms(n.id)
    from public.game_secrets gs
    join public.graph_nodes n on n.id = gs.secret_node_id
    left join public.bible_characters c on c.id = coalesce(gs.secret_character_id, n.character_id)
    where gs.game_session_id = p_session_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. Traversed path: live answered steps, in order.
--    {step_index, node_id, text, answer_label, prompt_kind, node_type, target_text}
-- -----------------------------------------------------------------------------
create or replace function public.dsa_path_json(p_session_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'step_index', m.step_index,
        'node_id', m.node_id,
        'text', coalesce(m.payload->>'text', public.dsa_prompt_text(n.node_type, n.label, n.question)),
        'answer_label', m.answer_label,
        'prompt_kind', k.kind,
        'node_type', n.node_type,
        'target_text', case when k.kind = 'SPINE' then (
          select public.dsa_prompt_text(t.node_type, t.label, t.question)
          from public.dsa_out_edges(m.node_id, 'DECISION') e
          join public.graph_nodes t on t.id = e.to_node_id
          where e.answer_class = public.dsa_answer_class(m.answer_label)
          order by e.child_position
          limit 1
        ) end
      )
      order by m.step_index
    ),
    '[]'::jsonb
  )
  from public.game_moves m
  left join public.graph_nodes n on n.id = m.node_id
  cross join lateral (
    select coalesce(
      m.payload->>'kind',
      case when n.node_type = 'QUESTION' then 'SPINE' else 'CHILD' end
    ) as kind
  ) k
  where m.game_session_id = p_session_id
    and m.move_type = 'ANSWER'
    and not m.is_undone;
$$;


-- -----------------------------------------------------------------------------
-- 5. State JSON: same as 0003, plus the session settings (the room creator's
--    choices, which the second player of a room needs to read).
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
    'settings', coalesce(v_session.settings, '{}'::jsonb)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. Game statistics, counted over every move (undone ones included), like
--    packages/core GameEngine.stats():
--    questions = QUESTION moves, non = ANSWER moves of class NON,
--    backs = BACK moves, rewinds = REWIND moves.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_game_stats(p_session_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'questions', count(*) filter (where m.move_type = 'QUESTION'),
    'non', count(*) filter (where m.move_type = 'ANSWER' and public.dsa_answer_class(m.answer_label) = 'NON'),
    'backs', count(*) filter (where m.move_type = 'BACK'),
    'rewinds', count(*) filter (where m.move_type = 'REWIND')
  )
  from public.game_moves m
  where m.game_session_id = p_session_id;
$$;


-- -----------------------------------------------------------------------------
-- 7. dsa_get_revealed_path -> jsonb
--    {status, winner, path, stats: {questions, non, backs, rewinds},
--     secret: null | {node_id, name, description, has_homonyms}}
--    secret is only filled after DISCOVERED / ABANDONED.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_get_revealed_path(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_secret  jsonb := null;
begin
  v_session := public.dsa_require_player(p_session_id, null, false);

  if v_session.status in ('DISCOVERED', 'ABANDONED') then
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

  return jsonb_build_object(
    'status', v_session.status,
    'winner', v_session.winner,
    'path', public.dsa_path_json(p_session_id),
    'stats', public.dsa_game_stats(p_session_id),
    'secret', v_secret
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 8. dsa_create_session(..., p_settings jsonb default '{}') -> (session_id, room_code)
--    Settings: an object whose only allowed key is input_mode ∈ VOICE|BUTTONS.
--    Missing input_mode is stored as BUTTONS. Anything else: DSA_INVALID_SETTINGS.
-- -----------------------------------------------------------------------------
create or replace function public.dsa_normalize_settings(p_settings jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_unknown  text;
  v_mode     jsonb;
begin
  if jsonb_typeof(v_settings) <> 'object' then
    raise exception 'DSA_INVALID_SETTINGS: settings must be a JSON object (got %)', jsonb_typeof(v_settings);
  end if;

  select string_agg(k, ', ' order by k) into v_unknown
  from jsonb_object_keys(v_settings) as k
  where k not in ('input_mode');

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

  return jsonb_build_object('input_mode', v_mode #>> '{}');
end;
$$;

drop function if exists public.dsa_create_session(text, text, text, text);
drop function if exists public.dsa_create_session(text, text, text, text, jsonb);

create function public.dsa_create_session(
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
  v_uid          uuid := auth.uid();
  v_mode         text := upper(btrim(p_mode));
  v_role         text := nullif(upper(btrim(p_role)), '');
  v_display_name text := nullif(btrim(p_display_name), '');
  v_settings     jsonb;
  v_graph_id     uuid;
  v_secret_id    uuid;
  v_character_id uuid;
  v_session_id   uuid;
  v_code         text;
  v_attempt      integer;
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

  select c.node_id into v_secret_id
  from public.dsa_playable_characters(v_graph_id) c
  order by random()
  limit 1;

  if v_secret_id is null then
    raise exception 'DSA_NO_PLAYABLE_SECRET: the graph has no playable CHARACTER node';
  end if;

  select n.character_id into v_character_id from public.graph_nodes n where n.id = v_secret_id;

  for v_attempt in 1..100 loop
    v_code := public.dsa_new_room_code();
    begin
      insert into public.game_sessions (graph_id, mode, status, room_code, awaiting, created_by, settings)
      values (v_graph_id, v_mode, 'WAITING', v_code, 'NONE', v_uid, v_settings)
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

  if v_mode = 'LOCAL' then
    insert into public.game_players (game_session_id, user_id, role, display_name)
    values (v_session_id, v_uid, 'TIREUR', v_display_name),
           (v_session_id, v_uid, 'DECOUVREUR', v_display_name);
  else
    insert into public.game_players (game_session_id, user_id, role, display_name)
    values (v_session_id, v_uid, v_role, v_display_name);

    if v_mode in ('AI_TIREUR', 'AI_DECOUVREUR') then
      insert into public.game_players (game_session_id, user_id, role, display_name, is_ai)
      values (v_session_id, null, case v_role when 'TIREUR' then 'DECOUVREUR' else 'TIREUR' end, 'IA', true);
    end if;
  end if;

  if v_mode <> 'HUMAN_VS_HUMAN' then
    perform public.dsa_start_play(v_session_id);
  end if;

  session_id := v_session_id;
  room_code := v_code;
  return next;
end;
$$;


-- -----------------------------------------------------------------------------
-- 9. Privileges (Supabase grants EXECUTE to anon/authenticated by default)
-- -----------------------------------------------------------------------------
-- Internal: owner only.
revoke all on function public.dsa_has_homonyms(uuid) from public, anon, authenticated;
revoke all on function public.dsa_path_json(uuid) from public, anon, authenticated;
revoke all on function public.dsa_state_json(uuid) from public, anon, authenticated;
revoke all on function public.dsa_game_stats(uuid) from public, anon, authenticated;
revoke all on function public.dsa_normalize_settings(jsonb) from public, anon, authenticated;

-- RPCs: signed-in users only.
revoke all on function public.dsa_get_my_secret(uuid) from public, anon;
revoke all on function public.dsa_get_revealed_path(uuid) from public, anon;
revoke all on function public.dsa_create_session(text, text, text, text, jsonb) from public, anon;

grant execute on function public.dsa_get_my_secret(uuid) to authenticated;
grant execute on function public.dsa_get_revealed_path(uuid) to authenticated;
grant execute on function public.dsa_create_session(text, text, text, text, jsonb) to authenticated;
