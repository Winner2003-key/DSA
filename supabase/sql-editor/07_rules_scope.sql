-- =============================================================================
-- DSA — 07_rules_scope.sql — UPGRADE: "QUESTION" goes back to the question that
--   opened the list, and practising one part of the book (brief S11)
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * For a project that already ran 00, 01 and 06_timer.sql. A new project runs
--   the regenerated 00_all_migrations.sql instead, which already contains this.
-- * Safe to run more than once.
-- * Expected result: "Success. No rows returned". Then run 90_tests.sql:
--   one row, ALL DSA TESTS PASSED.
--
-- Same content as supabase/migrations/0010_rules_scope.sql (keep them identical).
-- =============================================================================

-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0010_rules_scope.sql — "QUESTION" ×N goes back to the question that opened the
--                        list, and practising one part of the book
--                        (GAME_RULES.md §4, GRAPH_SPECIFICATION.md §2, brief S11)
--
-- Re-runnable. Requires 0001–0006, 0008 and 0009 (0007 is independent).
--
--   1. dsa_graph_tree                 the book as a tree: parent, depth, ancestors
--      dsa_replay                     each answered step with its prompt kind
--      dsa_rewind_target              how many steps "QUESTION" ×N keeps
--      dsa_do_rewind                  the new rule (same signature, new semantics)
--   2. dsa_sections                   every section with its number of names
--      dsa_list_sections              RPC for the picker: no name, no clue, no leaf
--      dsa_scope_characters           the names a scope allows
--      dsa_settings_scope             settings.scope as a uuid[]
--   3. dsa_normalize_settings         + scope (validated against the graph)
--      dsa_create_session             passes the graph to the validation
--      dsa_new_session                draws the secret inside the scope
--      dsa_redraw_secret              stays inside the scope
--      dsa_rematch                    keeps the scope
--      dsa_state_json                 + scope_labels (what the game screen shows)
--   4. privileges
--
-- Two rules, one principle: the questions never change. A scope restricts only
-- which name is drawn, so the pair still walks the whole book down to it; and
-- "QUESTION" ×N re-opens a list the pair is already in rather than stepping back
-- one answer at a time.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Prerequisite: the timed-games update (0009 / 06_timer.sql)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_check_time(uuid)') is null then
    raise exception 'DSA SETUP: this project predates the timed-games update; run 06_timer.sql first, then this file again';
  end if;
end;
$$;


-- #############################################################################
-- 1. "QUESTION" ×N — back to the question that opened the list (GAME_RULES §4)
-- #############################################################################

-- The graph as a tree, walked from START through approved edges only.
-- `ancestors` holds every node above this one (not itself), which is what both
-- the scope and the sections are counted with. `order_path` is the book's order:
-- arrays compare element by element, so a parent always sorts before its children.
-- The walk carries its own ancestors, so a cycle can never make it loop.
create or replace function public.dsa_graph_tree(p_graph_id uuid)
returns table (
  node_id    uuid,
  node_type  text,
  label      text,
  parent_id  uuid,
  depth      integer,
  ancestors  uuid[],
  order_path integer[]
)
language sql
stable
set search_path = public, pg_temp
as $$
  with recursive tree (node_id, node_type, label, parent_id, depth, ancestors, order_path) as (
    select n.id, n.node_type, n.label, null::uuid, 0, '{}'::uuid[], '{}'::integer[]
    from public.graph_nodes n
    where n.graph_id = p_graph_id
      and n.node_type = 'START'
      and n.review_status = 'APPROVED'
    union all
    select
      c.id,
      c.node_type,
      c.label,
      t.node_id,
      t.depth + 1,
      t.ancestors || t.node_id,
      t.order_path || e.order_index
    from tree t
    join public.graph_edges e on e.from_node_id = t.node_id
    join public.graph_nodes c on c.id = e.to_node_id
    where e.review_status = 'APPROVED'
      and c.review_status = 'APPROVED'
      and not (c.id = any (t.ancestors || t.node_id))
  )
  select t.node_id, t.node_type, t.label, t.parent_id, t.depth, t.ancestors, t.order_path
  from tree t;
$$;

-- replaySteps: every live answered step with the prompt it answered. `kind` is
-- SPINE or CHILD and `enters_level` is the rule itself — a step enters a level
-- when it is a spine answer (a DECISION edge always moves) or a child prompt
-- answered OUI. A child prompt answered NON only walks to the next sibling.
-- Mirrors entersLevel / enteringStepIndices in packages/core/src/rules.ts.
create or replace function public.dsa_replay(p_session_id uuid)
returns table (
  step_index     integer,
  prompt_node_id uuid,
  at_node_id     uuid,
  kind           text,
  answer_class   text,
  enters_level   boolean
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_graph_id uuid;
  v_node     uuid;
  v_cursor   integer := 0;
  v_step     record;
  v_prompt   record;
  v_class    text;
  v_next     uuid;
begin
  select s.graph_id into v_graph_id
  from public.game_sessions s
  where s.id = p_session_id;

  if v_graph_id is null then
    raise exception 'DSA_NOT_PLAYER: session not found';
  end if;

  v_node := public.dsa_initial_node(v_graph_id);

  for v_step in
    select m.step_index, m.node_id, m.answer_label
    from public.game_moves m
    where m.game_session_id = p_session_id
      and m.move_type = 'ANSWER'
      and not m.is_undone
    order by m.step_index
  loop
    select * into v_prompt from public.dsa_prompt_at(v_node, v_cursor);
    if not found or v_prompt.prompt_node_id is distinct from v_step.node_id then
      raise exception 'DSA_INVALID_STEP: step % no longer matches the graph', v_step.step_index;
    end if;

    v_class := public.dsa_answer_class(v_step.answer_label);

    step_index := v_step.step_index;
    prompt_node_id := v_prompt.prompt_node_id;
    at_node_id := v_node;
    kind := v_prompt.kind;
    answer_class := v_class;
    enters_level := (v_prompt.kind = 'SPINE') or (v_class = 'OUI');
    return next;

    if v_prompt.kind = 'SPINE' then
      select e.to_node_id into v_next
      from public.dsa_out_edges(v_node, 'DECISION') e
      where e.answer_class = v_class
      order by e.child_position
      limit 1;
      v_node := v_next;
      v_cursor := 0;
    elsif v_class = 'OUI' then
      v_node := v_prompt.prompt_node_id;
      v_cursor := 0;
    else
      v_cursor := v_cursor + 1;
    end if;
  end loop;

  return;
end;
$$;

-- How many steps "QUESTION" ×N keeps: the index of the N-th most recent entering
-- step, so that its own question is asked again. Fewer than N entering steps
-- means the pair goes back to the very first question (0) — not an error.
create or replace function public.dsa_rewind_target(p_session_id uuid, p_count integer)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select r.step_index
      from public.dsa_replay(p_session_id) r
      where r.enters_level
      order by r.step_index desc
      offset greatest(p_count, 1) - 1
      limit 1
    ),
    0
  );
$$;

-- Tireur says "QUESTION" x N: back to the question that opened the list the
-- Découvreur is in, N levels up. Everything from that question on is undone and
-- it is asked again. Same signature as 0003; only the semantics changed.
create or replace function public.dsa_do_rewind(p_session_id uuid, p_count integer, p_actor_user_id uuid, p_is_ai boolean)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_steps   integer;
  v_keep    integer;
begin
  select * into v_session from public.game_sessions s where s.id = p_session_id;
  perform public.dsa_assert_not_over(v_session);

  if v_session.status <> 'PLAYING' or v_session.awaiting not in ('QUESTION', 'ANSWER') then
    raise exception 'DSA_NOT_AWAITING_ANSWER: cannot rewind now (awaiting %)', v_session.awaiting;
  end if;

  v_steps := public.dsa_step_count(p_session_id);
  if p_count is null or p_count < 1 or p_count > 3 or v_steps = 0 then
    raise exception 'DSA_INVALID_REWIND: rewind count must be 1 to 3 and the game must have an answered step (got %, % answered)', p_count, v_steps;
  end if;

  v_keep := public.dsa_rewind_target(p_session_id, p_count);

  perform public.dsa_do_truncate(
    p_session_id, v_keep, 'REWIND', 'TIREUR', p_actor_user_id, p_is_ai,
    jsonb_build_object('count', p_count, 'from_step_count', v_steps)
  );
end;
$$;


-- #############################################################################
-- 2. Practising one part of the book (B7)
-- #############################################################################

-- Every section of a graph, in book order, with the number of playable names
-- underneath. A section is any approved non-CHARACTER node reachable from START,
-- so the spine questions (ANCIEN, HOMME, …) are sections too, and the START node
-- is the root that means "the whole book".
create or replace function public.dsa_sections(p_graph_id uuid)
returns table (
  node_id    uuid,
  label      text,
  parent_id  uuid,
  depth      integer,
  characters integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with tree as (
    select * from public.dsa_graph_tree(p_graph_id)
  ),
  playable as (
    select t.node_id, t.ancestors
    from tree t
    join public.dsa_playable_characters(p_graph_id) c on c.node_id = t.node_id
  ),
  counts as (
    select a.ancestor_id as node_id, count(*)::integer as characters
    from playable p
    cross join lateral unnest(p.ancestors) as a(ancestor_id)
    group by a.ancestor_id
  )
  select t.node_id, t.label, t.parent_id, t.depth, coalesce(c.characters, 0)
  from tree t
  left join counts c on c.node_id = t.node_id
  where t.node_type <> 'CHARACTER'
  order by t.order_path;
$$;

-- dsa_list_sections -> the picker's tree. Players only.
-- It returns labels, parents, depths and counts, and **never** a name, a clue or
-- a leaf: it says no more than the book's table of contents does.
create or replace function public.dsa_list_sections(p_graph_slug text)
returns table (
  node_id    uuid,
  label      text,
  parent_id  uuid,
  depth      integer,
  characters integer
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_graph_id uuid;
begin
  if auth.uid() is null then
    raise exception 'DSA_NOT_AUTHENTICATED: sign in first (anonymous sign-in is fine)';
  end if;

  v_graph_id := public.dsa_graph_for_play(p_graph_slug);

  return query
    select s.node_id, s.label, s.parent_id, s.depth, s.characters
    from public.dsa_sections(v_graph_id) s;
end;
$$;

-- The playable names a scope allows. An empty or null scope is the whole book.
create or replace function public.dsa_scope_characters(p_graph_id uuid, p_scope uuid[])
returns table (node_id uuid)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.node_id
  from public.dsa_playable_characters(p_graph_id) c
  where p_scope is null
     or cardinality(p_scope) = 0
     or exists (
       select 1
       from public.dsa_graph_tree(p_graph_id) t
       where t.node_id = c.node_id
         and t.ancestors && p_scope
     );
$$;

-- settings.scope as a uuid[] ('{}' when absent, null or empty).
create or replace function public.dsa_settings_scope(p_settings jsonb)
returns uuid[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select array_agg(value::uuid)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(p_settings, '{}'::jsonb)->'scope') = 'array'
            then p_settings->'scope'
          else '[]'::jsonb
        end
      )
    ),
    '{}'::uuid[]
  );
$$;


-- #############################################################################
-- 3. Settings, drawing the secret, and the state
-- #############################################################################

-- The validation needs the graph, so the function takes it. The one-argument
-- version of 0006/0009 is dropped: leaving it would make every call ambiguous.
drop function if exists public.dsa_normalize_settings(jsonb);

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

  -- The whole book stays the absence of the key, so an untouched game's settings
  -- keep exactly the shape they had before this migration.
  if cardinality(v_ids) > 0 then
    v_out := v_out || jsonb_build_object('scope', to_jsonb(v_ids));
  end if;

  return v_out;
end;
$$;

-- dsa_create_session: the graph is resolved before the settings, because the
-- scope is validated against it.
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

  perform public.dsa_cleanup_stale_sessions();

  return query
    select n.session_id, n.room_code
    from public.dsa_new_session(
      v_uid, v_graph_id, v_mode, v_role, nullif(btrim(p_display_name), ''), v_settings, null
    ) n;
end;
$$;

-- dsa_new_session: the secret is drawn among the playable names **inside** the
-- scope. Everything else is 0009.
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
  v_scope        uuid[];
begin
  v_scope := public.dsa_settings_scope(p_settings);

  select c.node_id into v_secret_id
  from public.dsa_scope_characters(p_graph_id, v_scope) c
  order by random()
  limit 1;

  if v_secret_id is null then
    if cardinality(v_scope) > 0 then
      raise exception 'DSA_NO_PLAYABLE_SECRET: the chosen part of the book has no playable name';
    end if;
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

-- dsa_redraw_secret (0009): the new name also comes from inside the scope.
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
  from public.dsa_scope_characters(v_session.graph_id, public.dsa_settings_scope(v_session.settings)) c
  where c.node_id <> v_secret.secret_node_id
    and not (c.node_id = any (coalesce(v_secret.previous_node_ids, '{}'::uuid[])))
  order by random()
  limit 1;

  if v_new is null then
    raise exception 'DSA_NO_PLAYABLE_SECRET: no other name is left to draw in this part of the book';
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

-- dsa_state_json (0009) + scope_labels: the chosen sections in book order, which
-- is what the game screen writes ("Partie : LES EVANGILES"). The ids are already
-- in `settings.scope`; the labels save the client a second call.
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
    'scope_labels', v_labels
  );
end;
$$;

-- dsa_rematch (0009), keeping the scope as well as the mode and the chronometer.
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
-- 4. Privileges (Supabase grants EXECUTE to anon/authenticated by default)
-- #############################################################################
-- Internal: owner only.
revoke all on function public.dsa_graph_tree(uuid) from public, anon, authenticated;
revoke all on function public.dsa_replay(uuid) from public, anon, authenticated;
revoke all on function public.dsa_rewind_target(uuid, integer) from public, anon, authenticated;
revoke all on function public.dsa_do_rewind(uuid, integer, uuid, boolean) from public, anon, authenticated;
revoke all on function public.dsa_sections(uuid) from public, anon, authenticated;
revoke all on function public.dsa_scope_characters(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.dsa_settings_scope(jsonb) from public, anon, authenticated;
revoke all on function public.dsa_normalize_settings(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.dsa_new_session(uuid, uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.dsa_state_json(uuid) from public, anon, authenticated;

-- RPCs: signed-in users only.
revoke all on function public.dsa_list_sections(text) from public, anon;
revoke all on function public.dsa_create_session(text, text, text, text, jsonb) from public, anon;
revoke all on function public.dsa_redraw_secret(uuid) from public, anon;
revoke all on function public.dsa_rematch(uuid, boolean) from public, anon;

grant execute on function public.dsa_list_sections(text) to authenticated;
grant execute on function public.dsa_create_session(text, text, text, text, jsonb) to authenticated;
grant execute on function public.dsa_redraw_secret(uuid) to authenticated;
grant execute on function public.dsa_rematch(uuid, boolean) to authenticated;
