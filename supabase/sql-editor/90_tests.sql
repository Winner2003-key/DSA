-- =============================================================================
-- DSA — 90_tests.sql — database rule and security tests
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * Requires 00_all_migrations.sql AND 01_seed_mini_graph.sql to have been run.
-- * Everything runs inside ONE transaction that is ROLLED BACK at the end:
--   test users, sessions, the dsa_test helper schema — nothing is kept.
-- * Expected final result: a single row  ALL DSA TESTS PASSED
--   Any failure stops the script with  DSA TEST FAILED [<scenario>]: <details>
--
-- Scenarios 1–12 come from docs/sessions/mini-graph-fixture.md; the extra
-- blocks cover HUMAN_VS_HUMAN create/join, room codes, DSA_ROOM_FULL, the AI
-- Tireur auto-answers and the error codes. Block 13 covers 0006 (game UX:
-- homonyms, path fields, stats, session settings). Block 14 covers 0008
-- (rooms: Tireur ready, stale-room cleanup, rematch). Blocks 15-17 cover 0009
-- (timed games, the name change before the start, and the book's own path).
--
-- Users are simulated like PostgREST does it: role `authenticated` plus
-- request.jwt.claims. The secret of a session is forced as the postgres role
-- (test-only) right after dsa_create_session.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Preconditions
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_get_state(uuid)') is null then
    raise exception 'DSA TEST SETUP: run 00_all_migrations.sql first';
  end if;
  if to_regprocedure('public.dsa_create_session(text,text,text,text,jsonb)') is null
     or to_regprocedure('public.dsa_has_homonyms(uuid)') is null then
    raise exception 'DSA TEST SETUP: this project predates the game UX update; run 03_game_ux.sql (or the new 00_all_migrations.sql) first';
  end if;
  if to_regprocedure('public.dsa_tireur_ready(uuid)') is null
     or to_regprocedure('public.dsa_rematch(uuid,boolean)') is null then
    raise exception 'DSA TEST SETUP: this project predates the rooms update; run 05_rooms.sql (or the new 00_all_migrations.sql) first';
  end if;
  if to_regprocedure('public.dsa_check_time(uuid)') is null
     or to_regprocedure('public.dsa_redraw_secret(uuid)') is null
     or to_regprocedure('public.dsa_get_solution_path(uuid)') is null then
    raise exception 'DSA TEST SETUP: this project predates the timed-games update; run 06_timer.sql (or the new 00_all_migrations.sql) first';
  end if;
  if not exists (select 1 from public.graphs where slug = 'mini') then
    raise exception 'DSA TEST SETUP: run 01_seed_mini_graph.sql first';
  end if;
  if (select count(*) from public.graph_nodes n join public.graphs g on g.id = n.graph_id
      where g.slug = 'mini' and n.review_status = 'APPROVED') <> 30 then
    raise exception 'DSA TEST SETUP: the mini graph must have 30 approved nodes; run 01_seed_mini_graph.sql again';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Test helpers (schema dsa_test, rolled back with everything else)
-- -----------------------------------------------------------------------------
create schema dsa_test;

-- Test user n (1..4)
create function dsa_test.u(p_n integer) returns uuid
language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000d5a' || p_n)::uuid;
$$;

-- Node id of a mini node key. Abbreviations from the fixture:
--   P = ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes
--   S = ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel
--   E = ancien[non]/homme[oui]/les-evangiles
create function dsa_test.nid(p_key text) returns uuid
language sql immutable security definer set search_path = public, pg_temp as $$
  select extensions.uuid_generate_v5(
    '6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a',
    'mini:' || case
      when p_key = 'P' or p_key like 'P/%' then 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes' || substr(p_key, 2)
      when p_key = 'S' or p_key like 'S[%' then 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel' || substr(p_key, 2)
      when p_key = 'E' or p_key like 'E/%' then 'ancien[non]/homme[oui]/les-evangiles' || substr(p_key, 2)
      else p_key
    end
  );
$$;

-- Act as a signed-in user (anonymous sign-ins are also `authenticated`).
create function dsa_test.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

-- Act as the anon role (not signed in).
create function dsa_test.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

-- Back to the SQL Editor's own role (postgres).
create function dsa_test.as_postgres() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function dsa_test.fail(p_scenario text, p_message text) returns void
language plpgsql as $$
begin
  raise exception 'DSA TEST FAILED [%]: %', p_scenario, p_message;
end;
$$;

create function dsa_test.check(p_scenario text, p_ok boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    perform dsa_test.fail(p_scenario, p_message);
  end if;
end;
$$;

create function dsa_test.eq(p_scenario text, p_what text, p_actual text, p_expected text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    perform dsa_test.fail(p_scenario, format('%s: expected %L, got %L', p_what, p_expected, p_actual));
  end if;
end;
$$;

-- jsonb equality, so a comparison never depends on how Postgres orders keys.
create function dsa_test.eq_json(p_scenario text, p_what text, p_actual jsonb, p_expected jsonb) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    perform dsa_test.fail(p_scenario, format('%s: expected %s, got %s',
      p_what, p_expected::text, coalesce(p_actual::text, '<null>')));
  end if;
end;
$$;

-- What dsa_timer_defaults should say, read as the owner.
create function dsa_test.timer_defaults() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('think_seconds', a.think_seconds, 'play_seconds', a.play_seconds, 'max_redraws', a.max_redraws)
  from public.dsa_app_settings() a;
$$;

-- The settings an untimed game is stored with, for the defaults of app_settings.
create function dsa_test.settings(p_input_mode text default 'BUTTONS', p_timed boolean default false) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('input_mode', p_input_mode, 'timed', p_timed, 'max_redraws', a.max_redraws)
       || case when p_timed
               then jsonb_build_object('think_seconds', a.think_seconds, 'play_seconds', a.play_seconds)
               else '{}'::jsonb end
  from public.dsa_app_settings() a;
$$;

-- Runs p_sql and requires it to fail with an error whose message starts with
-- p_expected (a DSA_* code) or whose SQLSTATE equals p_expected (e.g. 42501).
create function dsa_test.expect_error(p_scenario text, p_sql text, p_expected text) returns void
language plpgsql as $$
declare
  v_message text;
  v_state   text;
  v_raised  boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_raised := true;
    get stacked diagnostics v_message = message_text, v_state = returned_sqlstate;
  end;

  if not v_raised then
    perform dsa_test.fail(p_scenario, format('expected error %s from [%s], but it succeeded', p_expected, p_sql));
  elsif not (v_message like p_expected || '%' or v_state = p_expected) then
    perform dsa_test.fail(p_scenario, format('expected error %s from [%s], got [%s] %s', p_expected, p_sql, v_state, v_message));
  end if;
end;
$$;

create function dsa_test.prompt(p_session uuid) returns text
language sql as $$
  select public.dsa_get_state(p_session) -> 'prompt' ->> 'text';
$$;

-- "Prompt X -> A": the current prompt must be X; ask it; answer A.
-- The caller must hold both roles (LOCAL mode).
create function dsa_test.play(p_scenario text, p_session uuid, p_expected_prompt text, p_answer text) returns void
language plpgsql as $$
begin
  perform dsa_test.eq(p_scenario, 'prompt', dsa_test.prompt(p_session), p_expected_prompt);
  perform public.dsa_ask(p_session);
  perform public.dsa_answer(p_session, p_answer);
end;
$$;

create function dsa_test.path_str(p_path jsonb) returns text
language sql immutable as $$
  select coalesce(string_agg((x->>'text') || '=' || (x->>'answer_label'), ' > ' order by (x->>'step_index')::integer), '')
  from jsonb_array_elements(p_path) x;
$$;

-- The 0006 path fields, one step per segment: text:prompt_kind:node_type:target_text
-- (target_text is '-' when null).
-- The four 0006 counters, without the 0009 additions (timed, play_seconds,
-- found_in_seconds), which the timed-games block checks on their own.
create function dsa_test.core_stats(p_stats jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'questions', p_stats->'questions', 'non', p_stats->'non',
    'backs', p_stats->'backs', 'rewinds', p_stats->'rewinds');
$$;

create function dsa_test.path_fields(p_path jsonb) returns text
language sql immutable as $$
  select coalesce(string_agg(
    (x->>'text') || ':' || coalesce(x->>'prompt_kind', '?') || ':' || coalesce(x->>'node_type', '?') || ':' || coalesce(x->>'target_text', '-'),
    ' > ' order by (x->>'step_index')::integer), '')
  from jsonb_array_elements(p_path) x;
$$;

-- Creates a session as p_user and (test-only) forces its secret as postgres.
-- Since 0009 every mode with a human Tireur starts in the preparation phase, so
-- by default the helper also ends it (p_ready => false keeps the phase open).
-- A HUMAN_VS_HUMAN room is still WAITING here, so its caller does it.
create function dsa_test.new_session(
  p_user       uuid,
  p_mode       text,
  p_role       text,
  p_secret_key text,
  p_ready      boolean default true,
  p_settings   jsonb default '{}'::jsonb
) returns uuid
language plpgsql as $$
declare
  v_session uuid;
  v_secret  uuid;
begin
  perform dsa_test.as_user(p_user);
  select c.session_id into v_session from public.dsa_create_session('mini', p_mode, p_role, 'Test', p_settings) c;

  if p_secret_key is not null then
    perform dsa_test.as_postgres();
    v_secret := dsa_test.nid(p_secret_key);
    if not exists (select 1 from public.graph_nodes n where n.id = v_secret and n.node_type = 'CHARACTER') then
      perform dsa_test.fail('setup', 'unknown secret node key ' || p_secret_key);
    end if;
    update public.game_secrets gs
    set secret_node_id = v_secret,
        secret_character_id = (select n.character_id from public.graph_nodes n where n.id = v_secret)
    where gs.game_session_id = v_session;
    if not found then
      perform dsa_test.fail('setup', 'no game_secrets row for the new session');
    end if;
    perform dsa_test.as_user(p_user);
  end if;

  if p_ready and p_mode in ('LOCAL', 'AI_DECOUVREUR') then
    perform public.dsa_tireur_ready(v_session);
  end if;

  return v_session;
end;
$$;

grant usage on schema dsa_test to authenticated, anon;
grant execute on all functions in schema dsa_test to authenticated, anon;

-- Throwaway users (rolled back). User 4 becomes an admin.
insert into auth.users (id, aud, role, email) values
  (dsa_test.u(1), 'authenticated', 'authenticated', 'dsa-test-1@example.invalid'),
  (dsa_test.u(2), 'authenticated', 'authenticated', 'dsa-test-2@example.invalid'),
  (dsa_test.u(3), 'authenticated', 'authenticated', 'dsa-test-3@example.invalid'),
  (dsa_test.u(4), 'authenticated', 'authenticated', 'dsa-test-4@example.invalid');
insert into public.admin_users (user_id, note) values (dsa_test.u(4), 'dsa test admin');


-- =============================================================================
-- 0. Pure helpers: normalization and answer classes
-- =============================================================================
do $$
begin
  perform dsa_test.as_postgres();
  perform dsa_test.eq('0 normalize', 'Jésus-Christ', public.dsa_normalize('Jésus-Christ'), 'jesuschrist');
  perform dsa_test.eq('0 normalize', 'Jésus Christ', public.dsa_normalize('Jésus Christ'), 'jesuschrist');
  perform dsa_test.eq('0 normalize', 'CAÏN', public.dsa_normalize('CAÏN'), 'cain');
  perform dsa_test.eq('0 normalize', 'ISMAËL', public.dsa_normalize('ISMAËL'), 'ismael');
  perform dsa_test.eq('0 normalize', 'fils d''isaï', public.dsa_normalize('fils d''isaï'), 'filsdisai');
  perform dsa_test.eq('0 normalize', 'Œ', public.dsa_normalize('SŒUR'), 'soeur');

  perform dsa_test.eq('0 answer class', 'OUI', public.dsa_answer_class('OUI'), 'OUI');
  perform dsa_test.eq('0 answer class', 'non', public.dsa_answer_class('non'), 'NON');
  perform dsa_test.eq('0 answer class', 'OUIOUIOUI', public.dsa_answer_class('OUIOUIOUI'), 'OUI_REPETE');
  perform dsa_test.eq('0 answer class', 'oui oui', public.dsa_answer_class('oui oui'), 'OUI_REPETE');
  perform dsa_test.eq('0 answer class', 'OUIOUIOUIOUI', public.dsa_answer_class('OUIOUIOUIOUI'), 'OUI_REPETE');
  perform dsa_test.eq('0 answer class', 'NONONONON', public.dsa_answer_class('NONONONON'), 'NON_REPETE');
  perform dsa_test.eq('0 answer class', 'NONONONO', public.dsa_answer_class('NONONONO'), 'NON_REPETE');
  perform dsa_test.eq('0 answer class', 'NONONO', public.dsa_answer_class('NONONO'), 'NON_REPETE');
  perform dsa_test.eq('0 answer class', 'non non', public.dsa_answer_class('non non'), 'NON_REPETE');
  perform dsa_test.eq('0 answer class', 'Je ne sais pas', public.dsa_answer_class('Je ne sais pas'), 'JE_NE_SAIS_PAS');
  perform dsa_test.eq('0 answer class', 'NO', public.dsa_answer_class('NO'), 'AUTRE');
  perform dsa_test.eq('0 answer class', 'NONO', public.dsa_answer_class('NONO'), 'AUTRE');
  perform dsa_test.eq('0 answer class', 'NONNON', public.dsa_answer_class('NONNON'), 'NON_REPETE');
  perform dsa_test.eq('0 answer class', 'Oui.', public.dsa_answer_class('Oui.'), 'OUI');
  perform dsa_test.eq('0 answer class', 'OUI NON', public.dsa_answer_class('OUI NON'), 'AUTRE');
  perform dsa_test.eq('0 answer class', 'empty', public.dsa_answer_class(''), 'AUTRE');

  perform dsa_test.check('0 ancestor', public.dsa_is_ancestor_or_self(dsa_test.nid('P'), dsa_test.nid('P/lie-a-adam/classe-1/le-meurtrier--cain')),
    'P must be an ancestor of CAÏN');
  perform dsa_test.check('0 ancestor', public.dsa_is_ancestor_or_self(dsa_test.nid('ancien'), dsa_test.nid('E/fils-de-zebedee--jacques')),
    'ancien must be an ancestor of JACQUES');
  perform dsa_test.check('0 ancestor', not public.dsa_is_ancestor_or_self(dsa_test.nid('P/lie-a-abraham'), dsa_test.nid('P/lie-a-adam/classe-1/le-meurtrier--cain')),
    'LIE A ABRAHAM must not be an ancestor of CAÏN');
  perform dsa_test.eq('0 playable', 'playable characters',
    (select count(*)::text from public.dsa_playable_characters((select g.id from public.graphs g where g.slug = 'mini'))), '13');
end;
$$;


-- =============================================================================
-- 1. Secret CAÏN, normal play
-- =============================================================================
do $$
declare
  c  constant text := '1 secret CAÏN normal play';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
  rp jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'status', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'awaiting', st->>'awaiting', 'QUESTION');
  perform dsa_test.eq(c, 'answer classes at ANCIEN', st->'prompt'->>'answer_classes', '["OUI", "NON"]');
  perform dsa_test.eq(c, 'players', jsonb_array_length(st->'players')::text, '2');

  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'PENTATEUQUE', 'OUI');
  perform dsa_test.play(c, s, 'LIE A ADAM', 'OUI');
  perform dsa_test.eq(c, 'CLASSE 1 node_type', public.dsa_get_state(s)->'prompt'->>'node_type', 'GROUP');
  perform dsa_test.play(c, s, 'CLASSE 1', 'OUI');
  perform dsa_test.eq(c, 'clue node_type', public.dsa_get_state(s)->'prompt'->>'node_type', 'CHARACTER');
  perform dsa_test.play(c, s, 'Premier homme', 'NON');
  perform dsa_test.play(c, s, 'Le meurtrier', 'OUI');

  st := public.dsa_get_state(s);
  perform dsa_test.check(c, st->'prompt' = 'null'::jsonb, 'prompt must be null at a CHARACTER, got ' || (st->'prompt')::text);
  perform dsa_test.eq(c, 'dead_end at CHARACTER', st->>'dead_end', 'false');
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_NO_PROMPT');

  st := public.dsa_guess(s, 'caïn');
  perform dsa_test.eq(c, 'awaiting after guess', st->>'awaiting', 'GUESS_CONFIRM');
  perform dsa_test.eq(c, 'pending_guess', st->>'pending_guess', 'caïn');
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, public.dsa_is_correct_name(s, 'caïn'), 'caïn must be the correct name');
  perform dsa_test.as_user(u);

  st := public.dsa_confirm_guess(s, 'OUI');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');

  rp := public.dsa_get_revealed_path(s);
  perform dsa_test.eq(c, 'revealed path length', jsonb_array_length(rp->'path')::text, '7');
  perform dsa_test.eq(c, 'revealed path', dsa_test.path_str(rp->'path'),
    'ANCIEN=OUI > HOMME=OUI > PENTATEUQUE=OUI > LIE A ADAM=OUI > CLASSE 1=OUI > Premier homme=NON > Le meurtrier=OUI');
  perform dsa_test.eq(c, 'discovered name', rp->'secret'->>'name', 'CAÏN');
  perform dsa_test.eq(c, 'description', rp->'secret'->>'description', 'Le meurtrier · LIE A ADAM');
  perform dsa_test.eq(c, 'winner', rp->>'winner', 'DECOUVREUR');
  perform dsa_test.eq(c, 'revealed path fields (0006)', dsa_test.path_fields(rp->'path'),
    'ANCIEN:SPINE:QUESTION:HOMME > HOMME:SPINE:QUESTION:PENTATEUQUE > PENTATEUQUE:SPINE:QUESTION:PENTATEUQUE (HOMMES)'
    || ' > LIE A ADAM:CHILD:CATEGORY:- > CLASSE 1:CHILD:GROUP:- > Premier homme:CHILD:CHARACTER:- > Le meurtrier:CHILD:CHARACTER:-');
  perform dsa_test.eq(c, 'state path fields == revealed path fields',
    dsa_test.path_fields(public.dsa_get_state(s)->'path'), dsa_test.path_fields(rp->'path'));
  perform dsa_test.eq_json(c, 'stats (0006)', dsa_test.core_stats(rp->'stats'), '{"non": 1, "backs": 0, "rewinds": 0, "questions": 7}');
  perform dsa_test.eq(c, 'CAÏN has no homonym', rp->'secret'->>'has_homonyms', 'false');
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_GAME_OVER');
  perform dsa_test.expect_error(c, format('select public.dsa_guess(%L, %L)', s, 'CAÏN'), 'DSA_GAME_OVER');
  perform dsa_test.expect_error(c, format('select public.dsa_abandon(%L)', s), 'DSA_GAME_OVER');
end;
$$;


-- =============================================================================
-- 2. Secret ABRAM (alias; aliases do not count)
-- =============================================================================
do $$
declare
  c  constant text := '2 secret ABRAM alias';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-abraham/pere-de-la-foi/moin-connu--abram');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'PENTATEUQUE', 'OUI');
  perform dsa_test.play(c, s, 'LIE A ADAM', 'NON');
  perform dsa_test.play(c, s, 'LIE A ABRAHAM', 'OUI');
  perform dsa_test.play(c, s, 'PÈRE DE LA FOI', 'OUI');
  perform dsa_test.play(c, s, 'plus connu', 'NON');
  perform dsa_test.play(c, s, 'moin connu', 'OUI');

  perform public.dsa_guess(s, 'Abraham');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'correct confirmation for "Abraham"', public.dsa_ai_tireur_answer(s), 'NON');
  perform dsa_test.as_user(u);
  st := public.dsa_confirm_guess(s, 'NON');
  perform dsa_test.eq(c, 'status after NON', st->>'status', 'PLAYING');

  perform public.dsa_guess(s, 'ABRAM');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'correct confirmation for "ABRAM"', public.dsa_ai_tireur_answer(s), 'OUI');
  perform dsa_test.as_user(u);
  st := public.dsa_confirm_guess(s, 'OUI');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');
end;
$$;


-- =============================================================================
-- 3. Secret ISAAC (TOME 1 is a question)
-- =============================================================================
do $$
declare
  c  constant text := '3 secret ISAAC tome';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-abraham/tome-1/fils-de-la-promesse--isaac');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'PENTATEUQUE', 'OUI');
  perform dsa_test.play(c, s, 'LIE A ADAM', 'NON');
  perform dsa_test.play(c, s, 'LIE A ABRAHAM', 'OUI');
  perform dsa_test.play(c, s, 'PÈRE DE LA FOI', 'NON');
  perform dsa_test.play(c, s, 'TOME 1', 'OUI');
  perform dsa_test.play(c, s, 'FILS D''AGAR', 'NON');
  perform dsa_test.play(c, s, 'FILS DE LA PROMESSE', 'OUI');
  perform public.dsa_guess(s, 'Isaac');
  st := public.dsa_confirm_guess(s, 'OUI');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');
end;
$$;


-- =============================================================================
-- 4. Secret DAVID, repeated codes
-- =============================================================================
do $$
declare
  c  constant text := '4 secret DAVID repeated codes';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'S[ouioui]/lie-a-david/fils-d-isai--david');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');

  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'PENTATEUQUE');
  perform dsa_test.eq(c, 'answer classes at PENTATEUQUE',
    public.dsa_get_state(s)->'prompt'->>'answer_classes', '["OUI", "NON", "NON_REPETE"]');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'correct answer at PENTATEUQUE', public.dsa_compute_answer(s), 'NON_REPETE');
  perform dsa_test.as_user(u);
  perform public.dsa_ask(s);
  st := public.dsa_answer(s, 'NONONO');
  perform dsa_test.eq(c, 'recorded label (book canonical)', st->'path'->-1->>'answer_label', 'NONONONON');

  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'LIVRE DE SAMUEL');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'correct answer at LIVRE DE SAMUEL', public.dsa_compute_answer(s), 'OUI_REPETE');
  perform dsa_test.as_user(u);
  perform public.dsa_ask(s);
  st := public.dsa_answer(s, 'OUI OUI');
  perform dsa_test.eq(c, 'recorded label (book canonical)', st->'path'->-1->>'answer_label', 'OUIOUIOUI');

  perform dsa_test.play(c, s, 'fils d''isaï', 'OUI');
  perform dsa_test.eq(c, 'path fields (0006)', dsa_test.path_fields(public.dsa_get_state(s)->'path'),
    'ANCIEN:SPINE:QUESTION:HOMME > HOMME:SPINE:QUESTION:PENTATEUQUE > PENTATEUQUE:SPINE:QUESTION:LIVRE DE SAMUEL'
    || ' > LIVRE DE SAMUEL:SPINE:QUESTION:LIE A DAVID > fils d''isaï:CHILD:CHARACTER:-');
  perform dsa_test.eq(c, 'target_text after OUIOUIOUI',
    public.dsa_get_state(s)->'path'->3->>'target_text', 'LIE A DAVID');
  perform public.dsa_guess(s, 'DAVID');
  st := public.dsa_confirm_guess(s, 'OUI');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');
end;
$$;


-- =============================================================================
-- 5. Secret JESUS-CHRIST (normalization)
-- =============================================================================
do $$
declare
  c  constant text := '5 secret JESUS-CHRIST normalization';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'E/le-sauveur--jesus-christ');
  perform dsa_test.play(c, s, 'ANCIEN', 'NON');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'le sauveur', 'OUI');
  perform public.dsa_guess(s, 'Jésus Christ');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'correct confirmation for "Jésus Christ"', public.dsa_ai_tireur_answer(s), 'OUI');
  perform dsa_test.as_user(u);
  st := public.dsa_confirm_guess(s, 'OUI');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');
end;
$$;


-- =============================================================================
-- 6. Name call at any time
-- =============================================================================
do $$
declare
  c  constant text := '6 name call at any time';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'ANCIEN');
  perform public.dsa_guess(s, 'David');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'correct confirmation for "David"', public.dsa_ai_tireur_answer(s), 'NON');
  perform dsa_test.as_user(u);
  st := public.dsa_confirm_guess(s, 'NON');
  perform dsa_test.eq(c, 'prompt after NON', st->'prompt'->>'text', 'ANCIEN');
  perform dsa_test.eq(c, 'status after NON', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'awaiting after NON', st->>'awaiting', 'QUESTION');
  perform dsa_test.check(c, st->'pending_guess' = 'null'::jsonb, 'pending_guess must be cleared');
  perform dsa_test.eq(c, 'path length', jsonb_array_length(st->'path')::text, '0');
end;
$$;


-- =============================================================================
-- 7. Tireur "QUESTION" x1
-- =============================================================================
do $$
declare
  c  constant text := '7 Tireur QUESTION x1';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
  rp jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'PENTATEUQUE', 'OUI');
  perform dsa_test.play(c, s, 'LIE A ADAM', 'NON');
  perform dsa_test.eq(c, 'prompt after the mistake', dsa_test.prompt(s), 'LIE A ABRAHAM');

  st := public.dsa_rewind(s, 1);
  perform dsa_test.eq(c, 'prompt after rewind(1)', st->'prompt'->>'text', 'LIE A ADAM');
  perform dsa_test.eq(c, 'path length after rewind(1)', jsonb_array_length(st->'path')::text, '3');

  perform dsa_test.play(c, s, 'LIE A ADAM', 'OUI');
  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'CLASSE 1');
  perform dsa_test.play(c, s, 'CLASSE 1', 'OUI');
  perform dsa_test.play(c, s, 'Premier homme', 'NON');
  perform dsa_test.play(c, s, 'Le meurtrier', 'OUI');
  perform public.dsa_guess(s, 'CAÏN');
  perform public.dsa_confirm_guess(s, 'OUI');

  rp := public.dsa_get_revealed_path(s);
  perform dsa_test.eq(c, 'revealed path', dsa_test.path_str(rp->'path'),
    'ANCIEN=OUI > HOMME=OUI > PENTATEUQUE=OUI > LIE A ADAM=OUI > CLASSE 1=OUI > Premier homme=NON > Le meurtrier=OUI');
  perform dsa_test.check(c, dsa_test.path_str(rp->'path') not like '%LIE A ADAM=NON%', 'the undone NON must not be revealed');
  -- stats count every move, undone ones included (like packages/core stats())
  perform dsa_test.eq_json(c, 'stats (0006)', dsa_test.core_stats(rp->'stats'), '{"non": 2, "backs": 0, "rewinds": 1, "questions": 8}');

  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'undone ANSWER moves',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.move_type = 'ANSWER' and m.is_undone), '1');
  perform dsa_test.eq(c, 'REWIND moves',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.move_type = 'REWIND'), '1');
end;
$$;


-- =============================================================================
-- 8. Tireur "QUESTION" x2
-- =============================================================================
do $$
declare
  c  constant text := '8 Tireur QUESTION x2';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'PENTATEUQUE', 'OUI');
  perform dsa_test.play(c, s, 'LIE A ADAM', 'NON');
  st := public.dsa_rewind(s, 2);
  perform dsa_test.eq(c, 'prompt after rewind(2)', st->'prompt'->>'text', 'PENTATEUQUE');
  perform dsa_test.eq(c, 'path after rewind(2)', dsa_test.path_str(st->'path'), 'ANCIEN=OUI > HOMME=OUI');

  -- rewinding while a question waits for its answer also drops that question
  perform public.dsa_ask(s);
  st := public.dsa_rewind(s, 1);
  perform dsa_test.eq(c, 'prompt after rewind(1) during ANSWER', st->'prompt'->>'text', 'HOMME');
  perform dsa_test.eq(c, 'awaiting after rewind during ANSWER', st->>'awaiting', 'QUESTION');
end;
$$;


-- =============================================================================
-- 9. Découvreur goes back after a dead end
-- =============================================================================
do $$
declare
  c   constant text := '9 go back after dead end';
  u   uuid := dsa_test.u(1);
  s   uuid;
  st  jsonb;
  act jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform dsa_test.play(c, s, 'PENTATEUQUE', 'NON');
  perform dsa_test.play(c, s, 'Serviteur de MOÏSE', 'NON');

  st := public.dsa_get_state(s);
  perform dsa_test.check(c, st->'prompt' = 'null'::jsonb, 'prompt must be null at a dead end');
  perform dsa_test.eq(c, 'dead_end', st->>'dead_end', 'true');
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_NO_PROMPT');

  perform dsa_test.as_postgres();
  act := public.dsa_ai_decouvreur_action(s);
  perform dsa_test.eq(c, 'AI Découvreur action at dead end', act::text, '{"type": "BACK", "step_index": 3}');
  perform dsa_test.as_user(u);

  st := public.dsa_go_back(s, 2);
  perform dsa_test.eq(c, 'prompt after go_back(2)', st->'prompt'->>'text', 'PENTATEUQUE');
  perform dsa_test.eq(c, 'dead_end after go_back', st->>'dead_end', 'false');
  perform dsa_test.eq(c, 'path after go_back(2)', dsa_test.path_str(st->'path'), 'ANCIEN=OUI > HOMME=OUI');

  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'undone ANSWER moves',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.move_type = 'ANSWER' and m.is_undone), '2');
  perform dsa_test.eq(c, 'undone QUESTION moves',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.move_type = 'QUESTION' and m.is_undone), '2');
  perform dsa_test.eq(c, 'stored position cursor',
    (select s2.child_cursor::text from public.game_sessions s2 where s2.id = s), '0');
  perform dsa_test.eq(c, 'stored position node',
    (select s2.current_node_id::text from public.game_sessions s2 where s2.id = s), dsa_test.nid('ancien[oui]/homme[oui]/pentateuque')::text);
  perform dsa_test.as_user(u);

  perform dsa_test.play(c, s, 'PENTATEUQUE', 'OUI');
  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'LIE A ADAM');
  perform dsa_test.eq_json(c, 'stats (0006)', dsa_test.core_stats(public.dsa_get_revealed_path(s)->'stats'),
    '{"non": 2, "backs": 1, "rewinds": 0, "questions": 5}');
end;
$$;


-- =============================================================================
-- 10. Answer validation (and the state-machine error codes)
-- =============================================================================
do $$
declare
  c  constant text := '10 answer validation';
  u  uuid := dsa_test.u(1);
  s  uuid;
  s2 uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');

  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'OUI'), 'DSA_NOT_AWAITING_ANSWER');
  perform dsa_test.expect_error(c, format('select public.dsa_confirm_guess(%L, %L)', s, 'OUI'), 'DSA_NOT_AWAITING_GUESS_CONFIRM');
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 1)', s), 'DSA_INVALID_REWIND');
  perform dsa_test.expect_error(c, format('select public.dsa_go_back(%L, 0)', s), 'DSA_INVALID_STEP');

  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');

  -- HOMME accepts JE NE SAIS PAS (a human Tireur is not forced to be correct)
  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'HOMME');
  perform public.dsa_ask(s);
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_NOT_AWAITING_QUESTION');
  perform dsa_test.expect_error(c, format('select public.dsa_guess(%L, %L)', s, 'ADAM'), 'DSA_NOT_AWAITING_QUESTION');
  st := public.dsa_answer(s, 'JE NE SAIS PAS');
  perform dsa_test.eq(c, 'prompt after JE NE SAIS PAS at HOMME', st->'prompt'->>'text', 'VERSÉ DANS LES ÉCRITURES');
  perform public.dsa_rewind(s, 1);

  perform dsa_test.play(c, s, 'HOMME', 'OUI');

  -- PENTATEUQUE rejects JE NE SAIS PAS
  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'PENTATEUQUE');
  perform public.dsa_ask(s);
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'JE NE SAIS PAS'), 'DSA_ANSWER_NOT_ALLOWED');
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'OUI OUI'), 'DSA_ANSWER_NOT_ALLOWED');
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'PEUT-ÊTRE'), 'DSA_ANSWER_NOT_ALLOWED');
  perform public.dsa_answer(s, 'OUI');

  -- child prompt: only OUI / NON
  perform dsa_test.eq(c, 'prompt', dsa_test.prompt(s), 'LIE A ADAM');
  perform public.dsa_ask(s);
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'OUI OUI OUI'), 'DSA_ANSWER_NOT_ALLOWED');
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'NONONO'), 'DSA_ANSWER_NOT_ALLOWED');
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'JE NE SAIS PAS'), 'DSA_ANSWER_NOT_ALLOWED');
  perform public.dsa_answer(s, 'NON');

  -- 4 steps exist; rewind(4) is still rejected (1..3 only)
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 4)', s), 'DSA_INVALID_REWIND');
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 0)', s), 'DSA_INVALID_REWIND');
  perform dsa_test.expect_error(c, format('select public.dsa_go_back(%L, 4)', s), 'DSA_INVALID_STEP');
  perform dsa_test.expect_error(c, format('select public.dsa_go_back(%L, -1)', s), 'DSA_INVALID_STEP');

  -- more steps than exist
  s2 := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  perform dsa_test.play(c, s2, 'ANCIEN', 'OUI');
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 2)', s2), 'DSA_INVALID_REWIND');
  st := public.dsa_rewind(s2, 1);
  perform dsa_test.eq(c, 'prompt after rewind to the start', st->'prompt'->>'text', 'ANCIEN');

  -- empty name, bad graph / mode / role
  perform dsa_test.expect_error(c, format('select public.dsa_guess(%L, %L)', s2, ' - '), 'DSA_INVALID_NAME');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('nope', 'LOCAL')$q$, 'DSA_GRAPH_NOT_FOUND');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'SOLO')$q$, 'DSA_INVALID_MODE');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'HUMAN_VS_HUMAN')$q$, 'DSA_INVALID_ROLE');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'AI_TIREUR', 'TIREUR')$q$, 'DSA_INVALID_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_ai_decouvreur_step(%L)', s2), 'DSA_WRONG_MODE');
end;
$$;


-- =============================================================================
-- 11. AI: for every playable secret, AI Tireur + AI Découvreur reach DISCOVERED,
--     and every AI Tireur answer equals the correct answer.
-- =============================================================================

-- 11a. AI_TIREUR session; the test plays the AI Découvreur's actions.
do $$
declare
  c         constant text := '11a AI Tireur + AI Découvreur actions';
  u         uuid := dsa_test.u(1);
  v_secrets uuid[];
  v_secret  uuid;
  v_key     text;
  v_label   text;
  s         uuid;
  st        jsonb;
  act       jsonb;
  v_class   text;
  v_label_x text;
  i         integer;
  v_done    integer := 0;
begin
  perform dsa_test.as_postgres();
  select array_agg(p.node_id order by p.node_id) into v_secrets
  from public.dsa_playable_characters((select g.id from public.graphs g where g.slug = 'mini')) p;

  foreach v_secret in array v_secrets loop
    perform dsa_test.as_postgres();
    select n.node_key, n.label into v_key, v_label from public.graph_nodes n where n.id = v_secret;

    s := dsa_test.new_session(u, 'AI_TIREUR', null, v_key);
    st := public.dsa_get_state(s);

    for i in 1..60 loop
      perform dsa_test.as_postgres();
      act := public.dsa_ai_decouvreur_action(s);
      v_class := public.dsa_compute_answer(s);
      v_label_x := public.dsa_ai_tireur_answer(s);
      perform dsa_test.as_user(u);

      case act->>'type'
        when 'ASK' then
          st := public.dsa_ask(s);
          perform dsa_test.eq(c || ' ' || v_key, 'AI Tireur label', st->'path'->-1->>'answer_label', v_label_x);
          perform dsa_test.as_postgres();
          perform dsa_test.eq(c || ' ' || v_key, 'AI Tireur answer class vs correct answer',
            public.dsa_answer_class(v_label_x), v_class);
          perform dsa_test.as_user(u);
        when 'GUESS' then
          st := public.dsa_guess(s, act->>'name');
        else
          perform dsa_test.fail(c || ' ' || v_key, 'unexpected AI Découvreur action ' || act::text);
      end case;

      exit when st->>'status' = 'DISCOVERED';
    end loop;

    perform dsa_test.eq(c || ' ' || v_key, 'status', st->>'status', 'DISCOVERED');
    perform dsa_test.eq(c || ' ' || v_key, 'discovered name', public.dsa_get_revealed_path(s)->'secret'->>'name', v_label);
    v_done := v_done + 1;
  end loop;

  perform dsa_test.eq(c, 'secrets played', v_done::text, '13');
end;
$$;

-- 11b. AI_DECOUVREUR session; the test is a truthful Tireur.
do $$
declare
  c         constant text := '11b AI Découvreur step + truthful Tireur';
  u         uuid := dsa_test.u(1);
  v_secrets uuid[];
  v_secret  uuid;
  v_key     text;
  s         uuid;
  st        jsonb;
  v_answer  text;
  i         integer;
  v_done    integer := 0;
begin
  perform dsa_test.as_postgres();
  select array_agg(p.node_id order by p.node_id) into v_secrets
  from public.dsa_playable_characters((select g.id from public.graphs g where g.slug = 'mini')) p;

  foreach v_secret in array v_secrets loop
    perform dsa_test.as_postgres();
    select n.node_key into v_key from public.graph_nodes n where n.id = v_secret;

    s := dsa_test.new_session(u, 'AI_DECOUVREUR', 'TIREUR', v_key);
    perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_WRONG_ROLE');

    for i in 1..80 loop
      st := public.dsa_get_state(s);
      exit when st->>'status' = 'DISCOVERED';

      if st->>'awaiting' = 'QUESTION' then
        perform public.dsa_ai_decouvreur_step(s);
      else
        perform dsa_test.as_postgres();
        v_answer := public.dsa_ai_tireur_answer(s);
        perform dsa_test.as_user(u);
        if st->>'awaiting' = 'ANSWER' then
          perform dsa_test.expect_error(c, format('select public.dsa_ai_decouvreur_step(%L)', s), 'DSA_NOT_AWAITING_QUESTION');
          perform public.dsa_answer(s, v_answer);
        else
          perform public.dsa_confirm_guess(s, v_answer);
        end if;
      end if;
    end loop;

    perform dsa_test.eq(c || ' ' || v_key, 'status', st->>'status', 'DISCOVERED');
    perform dsa_test.as_postgres();
    perform dsa_test.eq(c || ' ' || v_key, 'undone moves with a truthful Tireur',
      (select count(*)::text from public.game_moves m where m.game_session_id = s and m.is_undone), '0');
    perform dsa_test.as_user(u);
    v_done := v_done + 1;
  end loop;

  perform dsa_test.eq(c, 'secrets played', v_done::text, '13');
end;
$$;

-- 11c. AI_DECOUVREUR goes back after a (human Tireur) wrong NON.
do $$
declare
  c  constant text := '11c AI Découvreur goes back';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'AI_DECOUVREUR', null, 'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue');
  perform public.dsa_ai_decouvreur_step(s);            -- asks ANCIEN
  perform public.dsa_answer(s, 'OUI');
  perform public.dsa_ai_decouvreur_step(s);            -- asks HOMME
  perform public.dsa_answer(s, 'OUI');
  perform public.dsa_ai_decouvreur_step(s);            -- asks PENTATEUQUE
  perform public.dsa_answer(s, 'NON');
  st := public.dsa_ai_decouvreur_step(s);              -- asks Serviteur de MOÏSE
  perform dsa_test.eq(c, 'asked prompt', st->'prompt'->>'text', 'Serviteur de MOÏSE');
  st := public.dsa_answer(s, 'NON');                   -- human mistake -> dead end
  perform dsa_test.eq(c, 'dead_end', st->>'dead_end', 'true');
  st := public.dsa_ai_decouvreur_step(s);              -- BACK to step 3
  perform dsa_test.eq(c, 'prompt after AI back', st->'prompt'->>'text', 'Serviteur de MOÏSE');
  perform dsa_test.eq(c, 'path after AI back', jsonb_array_length(st->'path')::text, '3');
  perform public.dsa_ai_decouvreur_step(s);            -- asks again
  perform public.dsa_answer(s, 'OUI');
  st := public.dsa_ai_decouvreur_step(s);              -- calls JOSUE
  perform dsa_test.eq(c, 'AI name call', st->>'pending_guess', 'JOSUE');
  st := public.dsa_confirm_guess(s, 'OUI');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');
end;
$$;


-- =============================================================================
-- AI_TIREUR auto-answers (explicit)
-- =============================================================================
do $$
declare
  c  constant text := 'AI_TIREUR auto-answer';
  u  uuid := dsa_test.u(1);
  s  uuid;
  st jsonb;
begin
  s := dsa_test.new_session(u, 'AI_TIREUR', null, 'E/fils-de-zebedee--jacques');
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'players', st->'players'->>0, '{"role": "TIREUR", "is_ai": true, "is_me": false, "display_name": "IA"}');

  st := public.dsa_ask(s);
  perform dsa_test.eq(c, 'awaiting after ask', st->>'awaiting', 'QUESTION');
  perform dsa_test.eq(c, 'auto answer at ANCIEN', dsa_test.path_str(st->'path'), 'ANCIEN=NON');
  perform dsa_test.eq(c, 'next prompt', st->'prompt'->>'text', 'HOMME');

  st := public.dsa_guess(s, 'Pierre');
  perform dsa_test.eq(c, 'status after wrong name', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'awaiting after wrong name', st->>'awaiting', 'QUESTION');

  perform public.dsa_ask(s);                                  -- HOMME -> OUI
  st := public.dsa_ask(s);                                    -- le sauveur -> NON
  perform dsa_test.eq(c, 'prompt', st->'prompt'->>'text', 'Fils d''Alphée');
  st := public.dsa_ask(s);                                    -- Fils d'Alphée -> NON
  st := public.dsa_ask(s);                                    -- Fils de Zébédée -> OUI
  perform dsa_test.eq(c, 'path', dsa_test.path_str(st->'path'),
    'ANCIEN=NON > HOMME=OUI > le sauveur=NON > Fils d''Alphée=NON > Fils de Zébédée=OUI');

  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'OUI'), 'DSA_WRONG_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 1)', s), 'DSA_WRONG_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_get_my_secret(%L)', s), 'DSA_WRONG_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_ai_decouvreur_step(%L)', s), 'DSA_WRONG_ROLE');

  st := public.dsa_guess(s, 'jacques');
  perform dsa_test.eq(c, 'status', st->>'status', 'DISCOVERED');

  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'AI moves are flagged',
    (select count(*)::text from public.game_moves m
     where m.game_session_id = s and m.move_type in ('ANSWER', 'GUESS_CONFIRM') and not m.is_ai), '0');
  perform dsa_test.eq(c, 'wrong-name confirmation recorded',
    (select string_agg(m.answer_label, ',' order by m.seq) from public.game_moves m
     where m.game_session_id = s and m.move_type = 'GUESS_CONFIRM'), 'NON,OUI');
end;
$$;


-- =============================================================================
-- HUMAN_VS_HUMAN create / join, room codes, DSA_ROOM_FULL, list names
-- =============================================================================
do $$
declare
  c      constant text := 'HUMAN_VS_HUMAN rooms';
  t      uuid := dsa_test.u(1);
  d      uuid := dsa_test.u(2);
  x      uuid := dsa_test.u(3);
  s      uuid;
  v_code text;
  v_role text;
  v_sid  uuid;
  st     jsonb;
  v_names text[];
begin
  perform dsa_test.as_user(t);
  select cs.session_id, cs.room_code into s, v_code
  from public.dsa_create_session('mini', 'HUMAN_VS_HUMAN', 'TIREUR', 'Awa') cs;
  perform dsa_test.check(c, v_code ~ '^DSA-[0-9]{4}$', 'room code format DSA-####, got ' || coalesce(v_code, 'null'));

  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'status before join', st->>'status', 'WAITING');
  perform dsa_test.eq(c, 'awaiting before join', st->>'awaiting', 'NONE');
  perform dsa_test.check(c, st->'prompt' = 'null'::jsonb, 'no prompt before the second player joins');

  perform dsa_test.as_user(d);
  perform dsa_test.expect_error(c, format('select public.dsa_get_state(%L)', s), 'DSA_NOT_PLAYER');
  perform dsa_test.expect_error(c, $q$select public.dsa_join_session('DSA-ABCD')$q$, 'DSA_ROOM_NOT_FOUND');

  -- the code is accepted without the prefix and in lower case
  select j.session_id, j.role into v_sid, v_role from public.dsa_join_session(' ' || lower(replace(v_code, '-', '')) || ' ', 'Bill') j;
  perform dsa_test.eq(c, 'joined session', v_sid::text, s::text);
  perform dsa_test.eq(c, 'joined role', v_role, 'DECOUVREUR');

  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'status after join', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'prompt after join', st->'prompt'->>'text', 'ANCIEN');
  perform dsa_test.eq(c, 'players after join', jsonb_array_length(st->'players')::text, '2');

  select j.role into v_role from public.dsa_join_session(v_code) j;
  perform dsa_test.eq(c, 'joining again keeps the role', v_role, 'DECOUVREUR');

  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select public.dsa_join_session(%L)', v_code), 'DSA_ROOM_FULL');

  -- joining an AI room is refused too
  perform dsa_test.as_user(t);
  select cs.room_code into v_code from public.dsa_create_session('mini', 'AI_TIREUR') cs;
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select public.dsa_join_session(%L)', v_code), 'DSA_ROOM_FULL');

  -- creator as DÉCOUVREUR; the joiner becomes TIREUR
  perform dsa_test.as_user(d);
  select cs.room_code into v_code from public.dsa_create_session('mini', 'HUMAN_VS_HUMAN', 'decouvreur') cs;
  perform dsa_test.as_user(x);
  select j.role into v_role from public.dsa_join_session(v_code) j;
  perform dsa_test.eq(c, 'free role', v_role, 'TIREUR');

  -- names for voice recognition: labels + character names + aliases, distinct
  v_names := public.dsa_list_names('mini');
  perform dsa_test.eq(c, 'dsa_list_names', array_to_string(v_names, ','),
    'ABRAHAM,ABRAM,ADAM,CAÏN,DAVID,ESDRAS,ISAAC,ISMAËL,JACQUES,JEROBOAM,JESUS-CHRIST,JOSUE');
end;
$$;


-- =============================================================================
-- 12. Security
-- =============================================================================
do $$
declare
  c        constant text := '12 security';
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  x        uuid := dsa_test.u(3);
  adm      uuid := dsa_test.u(4);
  s        uuid;
  v_code   text;
  v_secret uuid := dsa_test.nid('P/lie-a-adam/classe-1/le-meurtrier--cain');
  v_n      integer;
  st       jsonb;
  rp       jsonb;
  v_prompt text;
  v_row    record;
begin
  s := dsa_test.new_session(t, 'HUMAN_VS_HUMAN', 'TIREUR', 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  perform dsa_test.as_postgres();
  select gs.room_code into v_code from public.game_sessions gs where gs.id = s;
  perform dsa_test.as_user(d);
  perform public.dsa_join_session(v_code);

  ---- 0008: the Tireur looks at the card first; nothing about it reaches the Découvreur
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'tireur_ready before "Je suis prêt"', st->>'tireur_ready', 'false');
  perform dsa_test.check(c, position(v_secret::text in st::text) = 0, 'secret node id leaked in the ready phase');
  perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked in the ready phase');
  perform dsa_test.as_user(t);
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'tireur_ready after "Je suis prêt"', st->>'tireur_ready', 'true');
  perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked in dsa_tireur_ready');
  perform dsa_test.as_user(d);

  ---- the Découvreur cannot read the secret
  select count(*) into v_n from public.game_secrets;
  perform dsa_test.eq(c, 'game_secrets rows visible to the Découvreur', v_n::text, '0');
  perform dsa_test.expect_error(c, format('select * from public.dsa_get_my_secret(%L)', s), 'DSA_WRONG_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_compute_answer(%L)', s), '42501');
  perform dsa_test.expect_error(c, format('select public.dsa_ai_tireur_answer(%L)', s), '42501');
  perform dsa_test.expect_error(c, format('select public.dsa_derive_position(%L)', s), '42501');
  perform dsa_test.expect_error(c, $q$select public.dsa_normalize('x')$q$, '42501');
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'OUI'), 'DSA_WRONG_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 1)', s), 'DSA_WRONG_ROLE');

  ---- the Tireur can
  perform dsa_test.expect_error(c, format('select public.dsa_has_homonyms(%L)', v_secret), '42501');
  perform dsa_test.expect_error(c, format('select public.dsa_game_stats(%L)', s), '42501');
  perform dsa_test.expect_error(c, format('select public.dsa_path_json(%L)', s), '42501');
  perform dsa_test.expect_error(c, $q$select public.dsa_normalize_settings('{}')$q$, '42501');

  perform dsa_test.as_user(t);
  select count(*) into v_n from public.game_secrets gs where gs.game_session_id = s;
  perform dsa_test.eq(c, 'game_secrets rows visible to the Tireur', v_n::text, '1');
  select * into v_row from public.dsa_get_my_secret(s);
  perform dsa_test.eq(c, 'secret name', v_row.name, 'CAÏN');
  perform dsa_test.eq(c, 'secret has_homonyms', v_row.has_homonyms::text, 'false');
  perform dsa_test.eq(c, 'secret description', v_row.description, 'Le meurtrier · LIE A ADAM');
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_WRONG_ROLE');
  perform dsa_test.expect_error(c, format('select public.dsa_go_back(%L, 0)', s), 'DSA_WRONG_ROLE');

  ---- dsa_get_state never shows the secret before the end (until it is the prompt)
  foreach v_prompt in array array['ANCIEN', 'HOMME', 'PENTATEUQUE', 'LIE A ADAM', 'CLASSE 1', 'Premier homme'] loop
    perform dsa_test.as_user(d);
    st := public.dsa_get_state(s);
    perform dsa_test.eq(c, 'prompt', st->'prompt'->>'text', v_prompt);
    perform dsa_test.check(c, position(v_secret::text in st::text) = 0, 'secret node id leaked in dsa_get_state at ' || v_prompt);
    perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked in dsa_get_state at ' || v_prompt);
    perform dsa_test.check(c, position('CAÏN' in public.dsa_get_revealed_path(s)::text) = 0, 'secret leaked in dsa_get_revealed_path at ' || v_prompt);
    perform dsa_test.check(c, public.dsa_get_revealed_path(s)->'secret' = 'null'::jsonb, 'revealed secret must be null before the end');
    perform dsa_test.check(c, position('homonym' in public.dsa_get_revealed_path(s)::text) = 0, 'has_homonyms must not appear before the end');
    perform dsa_test.check(c, not exists (
      select 1 from jsonb_array_elements(st->'path') pe
      where position('CAÏN' in coalesce(pe->>'target_text', '') || coalesce(pe->>'node_type', '') || coalesce(pe->>'prompt_kind', '')) > 0
    ), 'secret name leaked in the 0006 path fields at ' || v_prompt);
    perform dsa_test.check(c, not exists (
      select 1 from jsonb_array_elements(st->'path') pe
      where pe->>'node_type' = 'CHARACTER' or (pe->>'prompt_kind' = 'SPINE' and pe->>'target_text' is null)
         or (pe->>'prompt_kind' = 'CHILD' and pe->>'target_text' is not null)
    ), 'unexpected 0006 path fields at ' || v_prompt || ': ' || (st->'path')::text);
    st := public.dsa_ask(s);
    perform dsa_test.check(c, position(v_secret::text in st::text) = 0, 'secret node id leaked in dsa_ask at ' || v_prompt);
    perform dsa_test.as_user(t);
    st := public.dsa_answer(s, case when v_prompt = 'Premier homme' then 'NON' else 'OUI' end);
    perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked in dsa_answer at ' || v_prompt);
    if v_prompt <> 'Premier homme' then
      perform dsa_test.check(c, position(v_secret::text in st::text) = 0, 'secret node id leaked in dsa_answer at ' || v_prompt);
    end if;
  end loop;

  -- the secret's clue is now the current prompt: its node id may appear (spec §3), its name may not
  perform dsa_test.as_user(d);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'prompt', st->'prompt'->>'text', 'Le meurtrier');
  perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked at the secret''s own clue');

  ---- players read their session; nobody writes game tables directly
  perform dsa_test.as_user(d);
  select count(*) into v_n from public.game_sessions gs where gs.id = s;
  perform dsa_test.eq(c, 'Découvreur sees the session', v_n::text, '1');
  select count(*) into v_n from public.game_moves m where m.game_session_id = s;
  perform dsa_test.check(c, v_n > 0, 'Découvreur sees the moves');
  perform dsa_test.expect_error(c, format('update public.game_sessions set status = %L where id = %L', 'DISCOVERED', s), '42501');
  perform dsa_test.expect_error(c, format('insert into public.game_moves (game_session_id, move_type) values (%L, %L)', s, 'SYSTEM'), '42501');
  perform dsa_test.expect_error(c, format('delete from public.game_moves where game_session_id = %L', s), '42501');
  perform dsa_test.expect_error(c, format('insert into public.game_players (game_session_id, user_id, role) values (%L, %L, %L)', s, x, 'TIREUR'), '42501');
  perform dsa_test.expect_error(c, format('update public.game_secrets set secret_node_id = %L', v_secret), '42501');

  ---- messages: players read and insert their own
  insert into public.game_messages (game_session_id, body) values (s, 'Bonjour !');
  perform dsa_test.expect_error(c, format('insert into public.game_messages (game_session_id, user_id, body) values (%L, %L, %L)', s, t, 'fake'), '42501');
  perform dsa_test.expect_error(c, format('update public.game_messages set body = %L', 'edited'), '42501');
  perform dsa_test.as_user(t);
  select count(*) into v_n from public.game_messages gm where gm.game_session_id = s;
  perform dsa_test.eq(c, 'Tireur reads the message', v_n::text, '1');

  ---- outsiders see nothing
  perform dsa_test.as_user(x);
  select count(*) into v_n from public.game_sessions gs where gs.id = s;
  perform dsa_test.eq(c, 'outsider sees the session', v_n::text, '0');
  select count(*) into v_n from public.game_moves m where m.game_session_id = s;
  perform dsa_test.eq(c, 'outsider sees moves', v_n::text, '0');
  select count(*) into v_n from public.game_players p where p.game_session_id = s;
  perform dsa_test.eq(c, 'outsider sees players', v_n::text, '0');
  select count(*) into v_n from public.game_messages gm where gm.game_session_id = s;
  perform dsa_test.eq(c, 'outsider sees messages', v_n::text, '0');
  perform dsa_test.expect_error(c, format('select public.dsa_get_state(%L)', s), 'DSA_NOT_PLAYER');
  perform dsa_test.expect_error(c, format('select public.dsa_get_revealed_path(%L)', s), 'DSA_NOT_PLAYER');
  perform dsa_test.expect_error(c, format('select public.dsa_abandon(%L)', s), 'DSA_NOT_PLAYER');
  perform dsa_test.expect_error(c, format('insert into public.game_messages (game_session_id, body) values (%L, %L)', s, 'intrus'), '42501');

  ---- non-admins cannot read or write the graph tables
  select count(*) into v_n from public.graph_nodes;
  perform dsa_test.eq(c, 'graph_nodes visible to a non-admin', v_n::text, '0');
  select count(*) into v_n from public.graphs;
  perform dsa_test.eq(c, 'graphs visible to a non-admin', v_n::text, '0');
  select count(*) into v_n from public.admin_users;
  perform dsa_test.eq(c, 'admin_users visible to a non-admin', v_n::text, '0');
  perform dsa_test.expect_error(c,
    $q$insert into public.graphs (slug, name) values ('hack', 'hack')$q$, '42501');
  perform dsa_test.expect_error(c,
    format('insert into public.graph_nodes (graph_id, node_key, node_type, label) values (%L, %L, %L, %L)',
      extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini'), 'hack', 'CHARACTER', 'HACK'), '42501');
  perform dsa_test.expect_error(c,
    $q$insert into public.bible_characters (name) values ('HACK')$q$, '42501');
  perform dsa_test.expect_error(c,
    $q$insert into public.admin_users (user_id) values (auth.uid())$q$, '42501');
  update public.graphs set name = 'hacked' where slug = 'mini';
  get diagnostics v_n = row_count;
  perform dsa_test.eq(c, 'graphs rows updated by a non-admin', v_n::text, '0');
  delete from public.graph_edges;
  get diagnostics v_n = row_count;
  perform dsa_test.eq(c, 'graph_edges rows deleted by a non-admin', v_n::text, '0');

  ---- admins get full CRUD on graph tables
  perform dsa_test.as_user(adm);
  select count(*) into v_n from public.graph_nodes n join public.graphs g on g.id = n.graph_id where g.slug = 'mini';
  perform dsa_test.eq(c, 'graph_nodes visible to an admin', v_n::text, '30');
  update public.graphs set description = 'edited by admin' where slug = 'mini';
  get diagnostics v_n = row_count;
  perform dsa_test.eq(c, 'graphs rows updated by an admin', v_n::text, '1');
  select count(*) into v_n from public.admin_users;
  perform dsa_test.check(c, v_n >= 1, 'admins read admin_users');
  select count(*) into v_n from public.game_secrets gs where gs.game_session_id = s;
  perform dsa_test.eq(c, 'game_secrets visible to a non-player admin', v_n::text, '0');

  ---- anon (not signed in) gets nothing
  perform dsa_test.as_anon();
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL')$q$, '42501');
  perform dsa_test.expect_error(c, $q$select public.dsa_list_names('mini')$q$, '42501');
  perform dsa_test.expect_error(c, 'select count(*) from public.game_sessions', '42501');
  perform dsa_test.expect_error(c, 'select count(*) from public.graph_nodes', '42501');
  perform dsa_test.expect_error(c, 'select public.dsa_is_admin()', '42501');

  ---- after the end the secret is revealed to both players
  perform dsa_test.as_user(d);
  st := public.dsa_abandon(s);
  perform dsa_test.eq(c, 'status', st->>'status', 'ABANDONED');
  rp := public.dsa_get_revealed_path(s);
  perform dsa_test.eq(c, 'revealed after abandon', rp->'secret'->>'name', 'CAÏN');

  ---- the realtime publication never contains game_secrets
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_secrets'
  ), 'game_secrets must not be in supabase_realtime');
  perform dsa_test.eq(c, 'published game tables', (
    select string_agg(tablename::text, ',' order by tablename) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename::text like 'game_%'
  ), 'game_moves,game_players,game_sessions');
end;
$$;


-- =============================================================================
-- 13. Game UX (0006): homonyms, session settings
-- =============================================================================
do $$
declare
  c      constant text := '13 game UX homonyms';
  u      uuid := dsa_test.u(1);
  s      uuid;
  st     jsonb;
  rp     jsonb;
  v_row  record;
  v_group uuid := dsa_test.nid('P/lie-a-abraham/pere-de-la-foi');
  v_extra uuid := '00000000-0000-4000-8000-0000000d5a99';
  v_abram_char uuid;
begin
  ---- JACQUES: two different people share the name
  s := dsa_test.new_session(u, 'LOCAL', null, 'E/fils-d-alphee--jacques');
  select * into v_row from public.dsa_get_my_secret(s);
  perform dsa_test.eq(c, 'JACQUES name', v_row.name, 'JACQUES');
  perform dsa_test.eq(c, 'JACQUES has_homonyms', v_row.has_homonyms::text, 'true');
  perform dsa_test.eq(c, 'JACQUES description', v_row.description, 'Fils d''Alphée · LES EVANGILES');
  st := public.dsa_abandon(s);
  rp := public.dsa_get_revealed_path(s);
  perform dsa_test.eq(c, 'JACQUES revealed has_homonyms', rp->'secret'->>'has_homonyms', 'true');

  ---- CAÏN: unique name
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  select * into v_row from public.dsa_get_my_secret(s);
  perform dsa_test.eq(c, 'CAÏN has_homonyms', v_row.has_homonyms::text, 'false');

  ---- ABRAM / ABRAHAM: one person (one bible_characters row), never homonyms
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-abraham/pere-de-la-foi/moin-connu--abram');
  select * into v_row from public.dsa_get_my_secret(s);
  perform dsa_test.eq(c, 'ABRAM has_homonyms', v_row.has_homonyms::text, 'false');
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-abraham/pere-de-la-foi/plus-connu--abraham');
  select * into v_row from public.dsa_get_my_secret(s);
  perform dsa_test.eq(c, 'ABRAHAM has_homonyms', v_row.has_homonyms::text, 'false');

  -- A second "Abram" leaf of the same person (same character_id) is not a homonym;
  -- the same leaf pointing at another person is. (Rolled back; removed below.)
  perform dsa_test.as_postgres();
  select n.character_id into v_abram_char from public.graph_nodes n
  where n.id = dsa_test.nid('P/lie-a-abraham/pere-de-la-foi/moin-connu--abram');
  insert into public.graph_nodes (id, graph_id, node_key, node_type, label, question, character_id, review_status)
  select v_extra, n.graph_id, 'test/abram-bis', 'CHARACTER', 'Abram', 'test', v_abram_char, 'APPROVED'
  from public.graph_nodes n where n.id = v_group;
  insert into public.graph_edges (graph_id, from_node_id, to_node_id, answer_label, edge_kind, order_index, review_status)
  select n.graph_id, v_group, v_extra, 'OUI', 'HIERARCHY', 99, 'APPROVED'
  from public.graph_nodes n where n.id = v_group;
  perform dsa_test.eq(c, 'ABRAM with a second leaf of the same person',
    public.dsa_has_homonyms(dsa_test.nid('P/lie-a-abraham/pere-de-la-foi/moin-connu--abram'))::text, 'false');

  update public.graph_nodes set character_id = (select n.character_id from public.graph_nodes n
    where n.id = dsa_test.nid('P/lie-a-adam/classe-1/le-meurtrier--cain'))
  where id = v_extra;
  perform dsa_test.eq(c, 'ABRAM with a leaf of another person named Abram',
    public.dsa_has_homonyms(dsa_test.nid('P/lie-a-abraham/pere-de-la-foi/moin-connu--abram'))::text, 'true');

  -- an unreachable (not approved) homonym does not count
  update public.graph_nodes set review_status = 'NEEDS_REVIEW' where id = v_extra;
  perform dsa_test.eq(c, 'ABRAM with an unapproved homonym',
    public.dsa_has_homonyms(dsa_test.nid('P/lie-a-abraham/pere-de-la-foi/moin-connu--abram'))::text, 'false');

  delete from public.graph_edges where to_node_id = v_extra;
  delete from public.graph_nodes where id = v_extra;
  perform dsa_test.eq(c, 'mini graph restored',
    (select count(*)::text from public.graph_nodes n join public.graphs g on g.id = n.graph_id where g.slug = 'mini'), '30');
end;
$$;

do $$
declare
  c   constant text := '13 game UX settings';
  u   uuid := dsa_test.u(1);
  s   uuid;
  st  jsonb;
begin
  perform dsa_test.as_user(u);

  ---- default input_mode
  select cs.session_id into s from public.dsa_create_session('mini', 'LOCAL') cs;
  st := public.dsa_get_state(s);
  perform dsa_test.eq_json(c, 'default settings', st->'settings', dsa_test.settings());

  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR', null, null, '{}'::jsonb) cs;
  perform dsa_test.eq_json(c, 'empty settings', public.dsa_get_state(s)->'settings', dsa_test.settings());

  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR', null, null, null) cs;
  perform dsa_test.eq_json(c, 'null settings', public.dsa_get_state(s)->'settings', dsa_test.settings());

  ---- explicit values, by named argument like supabase-js sends them
  select cs.session_id into s from public.dsa_create_session(
    p_graph_slug => 'mini', p_mode => 'HUMAN_VS_HUMAN', p_role => 'TIREUR', p_display_name => 'Awa',
    p_settings => '{"input_mode": "VOICE"}'::jsonb) cs;
  perform dsa_test.eq_json(c, 'VOICE', public.dsa_get_state(s)->'settings', dsa_test.settings('VOICE'));

  select cs.session_id into s from public.dsa_create_session('mini', 'LOCAL', null, null, '{"input_mode": "BUTTONS"}') cs;
  perform dsa_test.eq_json(c, 'BUTTONS', public.dsa_get_state(s)->'settings', dsa_test.settings());

  perform dsa_test.as_postgres();
  perform dsa_test.eq_json(c, 'stored column', (select gs.settings from public.game_sessions gs where gs.id = s), dsa_test.settings());
  perform dsa_test.as_user(u);

  ---- validation
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL', null, null, '{"input_mode": "MIME"}')$q$, 'DSA_INVALID_SETTINGS');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL', null, null, '{"input_mode": "buttons"}')$q$, 'DSA_INVALID_SETTINGS');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL', null, null, '{"input_mode": 1}')$q$, 'DSA_INVALID_SETTINGS');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL', null, null, '{"think_seconds": 40}')$q$, 'DSA_INVALID_SETTINGS');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL', null, null, '{"input_mode": "VOICE", "x": true}')$q$, 'DSA_INVALID_SETTINGS');
  perform dsa_test.expect_error(c, $q$select public.dsa_create_session('mini', 'LOCAL', null, null, '["VOICE"]')$q$, 'DSA_INVALID_SETTINGS');

  ---- the old 4-argument signature is gone (no PostgREST overload ambiguity)
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, to_regprocedure('public.dsa_create_session(text,text,text,text)') is null,
    'the 4-argument dsa_create_session must be dropped');
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_create_session(text,text,text,text,jsonb)', 'execute'),
    'authenticated must be able to execute dsa_create_session');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_create_session(text,text,text,text,jsonb)', 'execute'),
    'anon must not execute dsa_create_session');
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_get_my_secret(uuid)', 'execute'),
    'authenticated must be able to execute dsa_get_my_secret');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_get_my_secret(uuid)', 'execute'),
    'anon must not execute dsa_get_my_secret');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_has_homonyms(uuid)', 'execute'),
    'dsa_has_homonyms must stay internal');
end;
$$;


-- =============================================================================
-- 14. Rooms (0008): the Tireur is ready first, stale rooms, rematch
-- =============================================================================
do $$
declare
  c        constant text := '14 rooms: Tireur ready';
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  x        uuid := dsa_test.u(3);
  s        uuid;
  v_code   text;
  v_secret uuid := dsa_test.nid('P/lie-a-adam/classe-1/le-meurtrier--cain');
  v_n      integer;
  st       jsonb;
begin
  s := dsa_test.new_session(t, 'HUMAN_VS_HUMAN', 'TIREUR', 'P/lie-a-adam/classe-1/le-meurtrier--cain');
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'WAITING: tireur_ready', st->>'tireur_ready', 'false');
  perform dsa_test.check(c, st->>'room_code' ~ '^DSA-[0-9]{4}$', 'room_code in the state, got ' || coalesce(st->>'room_code', 'null'));
  v_code := st->>'room_code';

  -- before the Découvreur is there, the Tireur cannot end the phase
  perform dsa_test.expect_error(c, format('select public.dsa_tireur_ready(%L)', s), 'DSA_WAITING_FOR_PLAYER');

  perform dsa_test.as_user(d);
  perform public.dsa_join_session(v_code, 'Bill');
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'joined: status', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'joined: tireur_ready', st->>'tireur_ready', 'false');
  perform dsa_test.eq(c, 'joined: room_code', st->>'room_code', v_code);
  perform dsa_test.eq(c, 'joined: awaiting', st->>'awaiting', 'QUESTION');
  perform dsa_test.check(c, position(v_secret::text in st::text) = 0, 'secret node id leaked while not ready');
  perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked while not ready');
  perform dsa_test.check(c, position('meurtrier' in st::text) = 0, 'secret clue leaked while not ready');

  -- the Découvreur waits
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_TIREUR_NOT_READY');
  perform dsa_test.expect_error(c, format('select public.dsa_guess(%L, %L)', s, 'CAÏN'), 'DSA_TIREUR_NOT_READY');
  perform dsa_test.expect_error(c, format('select public.dsa_tireur_ready(%L)', s), 'DSA_WRONG_ROLE');
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select public.dsa_tireur_ready(%L)', s), 'DSA_NOT_PLAYER');

  -- the Tireur is ready; a second call changes nothing
  perform dsa_test.as_user(t);
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'ready: tireur_ready', st->>'tireur_ready', 'true');
  perform dsa_test.eq(c, 'ready: prompt', st->'prompt'->>'text', 'ANCIEN');
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'ready twice: tireur_ready', st->>'tireur_ready', 'true');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'one TIREUR_READY move',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.payload->>'event' = 'TIREUR_READY'), '1');
  perform dsa_test.check(c, (select gs.tireur_ready_at is not null from public.game_sessions gs where gs.id = s), 'tireur_ready_at stored');

  -- now the Découvreur plays
  perform dsa_test.as_user(d);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'Découvreur sees tireur_ready', st->>'tireur_ready', 'true');
  perform dsa_test.check(c, position('CAÏN' in st::text) = 0, 'secret name leaked after ready');
  st := public.dsa_ask(s);
  perform dsa_test.eq(c, 'ask after ready', st->>'awaiting', 'ANSWER');
  perform dsa_test.as_user(t);
  perform public.dsa_answer(s, 'OUI');
  perform dsa_test.as_user(d);
  st := public.dsa_guess(s, 'ABEL');
  perform dsa_test.eq(c, 'guess after ready', st->>'awaiting', 'GUESS_CONFIRM');

  -- over: GAME_OVER wins over everything
  perform public.dsa_abandon(s);
  perform dsa_test.as_user(t);
  perform dsa_test.expect_error(c, format('select public.dsa_tireur_ready(%L)', s), 'DSA_GAME_OVER');

  -- 0009: every mode with a human Tireur now has the same preparation phase.
  perform dsa_test.as_user(t);
  select cs.session_id into s from public.dsa_create_session('mini', 'LOCAL') cs;
  perform dsa_test.eq(c, 'LOCAL starts unready', public.dsa_get_state(s)->>'tireur_ready', 'false');
  perform dsa_test.eq(c, 'LOCAL starts THINKING', public.dsa_get_state(s)->>'phase', 'THINKING');
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_TIREUR_NOT_READY');
  perform dsa_test.expect_error(c, format('select public.dsa_guess(%L, %L)', s, 'CAÏN'), 'DSA_TIREUR_NOT_READY');
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'LOCAL ready', st->>'tireur_ready', 'true');
  perform dsa_test.eq(c, 'LOCAL phase', st->>'phase', 'PLAYING');
  st := public.dsa_ask(s);
  perform dsa_test.eq(c, 'LOCAL plays once ready', st->>'awaiting', 'ANSWER');

  -- The AI Tireur has no card to look at, so it is ready at creation.
  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR') cs;
  perform dsa_test.eq(c, 'AI_TIREUR tireur_ready', public.dsa_get_state(s)->>'tireur_ready', 'true');
  perform dsa_test.expect_error(c, format('select public.dsa_tireur_ready(%L)', s), 'DSA_WRONG_ROLE');
  perform public.dsa_ask(s);

  select cs.session_id into s from public.dsa_create_session('mini', 'AI_DECOUVREUR') cs;
  perform dsa_test.eq(c, 'AI_DECOUVREUR starts unready', public.dsa_get_state(s)->>'tireur_ready', 'false');
  perform dsa_test.expect_error(c, format('select public.dsa_ai_decouvreur_step(%L)', s), 'DSA_TIREUR_NOT_READY');
  perform public.dsa_tireur_ready(s);
  st := public.dsa_ai_decouvreur_step(s);
  perform dsa_test.eq(c, 'AI_DECOUVREUR plays once ready', st->>'awaiting', 'ANSWER');

  ---- privileges
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_tireur_ready(uuid)', 'execute'),
    'authenticated must be able to execute dsa_tireur_ready');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_tireur_ready(uuid)', 'execute'),
    'anon must not execute dsa_tireur_ready');
  perform dsa_test.as_user(d);
  perform dsa_test.expect_error(c, format('select public.dsa_assert_tireur_ready(gs) from public.game_sessions gs where gs.id = %L', s), '42501');
end;
$$;

do $$
declare
  c        constant text := '14 rooms: stale cleanup';
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  x        uuid := dsa_test.u(3);
  s_wait   uuid;  -- WAITING, idle
  s_play   uuid;  -- PLAYING, idle
  s_fresh  uuid;  -- WAITING, active
  s_found  uuid;  -- DISCOVERED long ago
  s_left   uuid;  -- ABANDONED long ago
  s_join   uuid;  -- WAITING, idle, then someone tries to join it
  v_code   text;
  v_ended  timestamptz;
  v_n      integer;
begin
  perform dsa_test.as_user(t);
  select cs.session_id into s_wait from public.dsa_create_session('mini', 'HUMAN_VS_HUMAN', 'TIREUR') cs;
  select cs.session_id, cs.room_code into s_play, v_code from public.dsa_create_session('mini', 'HUMAN_VS_HUMAN', 'TIREUR') cs;
  perform dsa_test.as_user(d);
  perform public.dsa_join_session(v_code);
  perform dsa_test.as_user(t);
  select cs.session_id into s_fresh from public.dsa_create_session('mini', 'HUMAN_VS_HUMAN', 'DECOUVREUR') cs;
  s_found := dsa_test.new_session(t, 'AI_TIREUR', null, 'E/fils-de-zebedee--jacques');
  perform public.dsa_guess(s_found, 'JACQUES');
  select cs.session_id into s_left from public.dsa_create_session('mini', 'LOCAL') cs;
  perform public.dsa_abandon(s_left);

  -- Age the sessions (as the table owner, bypassing the updated_at trigger).
  perform dsa_test.as_postgres();
  alter table public.game_sessions disable trigger game_sessions_set_updated_at;
  update public.game_sessions set updated_at = now() - interval '7 hours'
  where id in (s_wait, s_play, s_found, s_left);
  update public.game_sessions set ended_at = now() - interval '7 hours' where id in (s_found, s_left);
  alter table public.game_sessions enable trigger game_sessions_set_updated_at;

  ---- internal only
  perform dsa_test.as_user(t);
  perform dsa_test.expect_error(c, 'select public.dsa_cleanup_stale_sessions()', '42501');
  perform dsa_test.as_anon();
  perform dsa_test.expect_error(c, 'select public.dsa_cleanup_stale_sessions()', '42501');
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_cleanup_stale_sessions(interval)', 'execute'),
    'authenticated must not execute dsa_cleanup_stale_sessions');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_cleanup_stale_sessions(interval)', 'execute'),
    'anon must not execute dsa_cleanup_stale_sessions');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_new_session(uuid,uuid,text,text,text,jsonb,uuid)', 'execute'),
    'dsa_new_session must stay internal');
  perform dsa_test.expect_error(c, $q$select public.dsa_cleanup_stale_sessions(interval '10 seconds')$q$, 'DSA_INVALID_IDLE');

  ---- a longer idle time closes nothing
  perform dsa_test.eq(c, 'closed with 8 hours', public.dsa_cleanup_stale_sessions(interval '8 hours')::text, '0');

  ---- default 6 hours: only the two idle open sessions
  -- (other open sessions of the project may also be idle: count ours only)
  perform public.dsa_cleanup_stale_sessions();
  perform dsa_test.eq(c, 'idle WAITING', (select status from public.game_sessions where id = s_wait), 'ABANDONED');
  perform dsa_test.eq(c, 'idle PLAYING', (select status from public.game_sessions where id = s_play), 'ABANDONED');
  perform dsa_test.eq(c, 'idle PLAYING awaiting', (select awaiting from public.game_sessions where id = s_play), 'NONE');
  perform dsa_test.check(c, (select ended_at is not null from public.game_sessions where id = s_play), 'ended_at set on a closed session');
  perform dsa_test.eq(c, 'IDLE moves',
    (select count(*)::text from public.game_moves m
     where m.game_session_id in (s_wait, s_play) and m.payload->>'reason' = 'IDLE'), '2');
  perform dsa_test.eq(c, 'active WAITING untouched', (select status from public.game_sessions where id = s_fresh), 'WAITING');
  perform dsa_test.eq(c, 'finished DISCOVERED untouched', (select status || '/' || winner from public.game_sessions where id = s_found), 'DISCOVERED/DECOUVREUR');
  perform dsa_test.eq(c, 'finished ABANDONED untouched', (select status from public.game_sessions where id = s_left), 'ABANDONED');
  select ended_at into v_ended from public.game_sessions where id = s_found;
  perform dsa_test.check(c, v_ended < now() - interval '6 hours', 'ended_at of a finished session must not change');
  perform dsa_test.eq(c, 'no IDLE move on finished sessions',
    (select count(*)::text from public.game_moves m
     where m.game_session_id in (s_found, s_left) and m.payload->>'reason' = 'IDLE'), '0');
  perform dsa_test.eq(c, 'second run closes nothing of ours', (
    select count(*)::text from public.game_sessions
    where id in (s_wait, s_play, s_fresh, s_found, s_left) and status in ('WAITING', 'READY', 'PLAYING') and id <> s_fresh), '0');

  ---- the players of a closed room see it ended
  perform dsa_test.as_user(d);
  perform dsa_test.eq(c, 'Découvreur state of the closed room', public.dsa_get_state(s_play)->>'status', 'ABANDONED');
  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s_play), 'DSA_GAME_OVER');

  ---- a joiner after cleanup: dsa_join_session cleans up first, then finds nothing
  perform dsa_test.as_user(t);
  select cs.session_id, cs.room_code into s_join, v_code from public.dsa_create_session('mini', 'HUMAN_VS_HUMAN', 'TIREUR') cs;
  perform dsa_test.as_postgres();
  alter table public.game_sessions disable trigger game_sessions_set_updated_at;
  update public.game_sessions set updated_at = now() - interval '6 hours 1 minute' where id = s_join;
  alter table public.game_sessions enable trigger game_sessions_set_updated_at;
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select public.dsa_join_session(%L)', v_code), 'DSA_ROOM_NOT_FOUND');
  perform dsa_test.as_postgres();
  select count(*) into v_n from public.game_players p where p.game_session_id = s_join;
  perform dsa_test.eq(c, 'nobody joined the idle room', v_n::text, '1');
  -- The error rolls back the join's own cleanup, so the row is closed by the next
  -- successful create/join (or the optional cron job), below.
  perform dsa_test.eq(c, 'a refused join leaves the row as it was', (select status from public.game_sessions where id = s_join), 'WAITING');

  ---- dsa_create_session cleans up too
  perform dsa_test.as_postgres();
  alter table public.game_sessions disable trigger game_sessions_set_updated_at;
  update public.game_sessions set updated_at = now() - interval '7 hours' where id = s_fresh;
  alter table public.game_sessions enable trigger game_sessions_set_updated_at;
  perform dsa_test.as_user(x);
  perform public.dsa_create_session('mini', 'AI_TIREUR');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'closed by dsa_create_session', (select status from public.game_sessions where id = s_fresh), 'ABANDONED');
  perform dsa_test.eq(c, 'idle room closed by dsa_create_session', (select status from public.game_sessions where id = s_join), 'ABANDONED');
end;
$$;

do $$
declare
  c       constant text := '14 rooms: rematch';
  t       uuid := dsa_test.u(1);
  d       uuid := dsa_test.u(2);
  x       uuid := dsa_test.u(3);
  s       uuid;
  v_code  text;
  r       record;
  r2      record;
  st      jsonb;
begin
  perform dsa_test.as_user(t);
  select cs.session_id, cs.room_code into s, v_code from public.dsa_create_session(
    p_graph_slug => 'mini', p_mode => 'HUMAN_VS_HUMAN', p_role => 'TIREUR', p_display_name => 'Awa',
    p_settings => '{"input_mode": "VOICE"}'::jsonb) cs;
  perform dsa_test.as_user(d);
  perform public.dsa_join_session(v_code, 'Bill');

  -- not before the end
  perform dsa_test.expect_error(c, format('select * from public.dsa_rematch(%L, true)', s), 'DSA_GAME_NOT_OVER');
  perform public.dsa_abandon(s);

  -- outsiders cannot use it
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select * from public.dsa_rematch(%L, false)', s), 'DSA_NOT_PLAYER');

  -- the Tireur proposes "Inverser les rôles"
  perform dsa_test.as_user(t);
  select * into r from public.dsa_rematch(s, true);
  perform dsa_test.eq(c, 'proposer takes the other role', r.role, 'DECOUVREUR');
  perform dsa_test.check(c, r.session_id <> s, 'a new session');
  perform dsa_test.check(c, r.room_code ~ '^DSA-[0-9]{4}$', 'a room code');
  st := public.dsa_get_state(r.session_id);
  perform dsa_test.eq(c, 'new room waits', st->>'status', 'WAITING');
  perform dsa_test.eq_json(c, 'same settings', st->'settings', dsa_test.settings('VOICE'));
  perform dsa_test.eq(c, 'display name kept', st->'players'->0->>'display_name', 'Awa');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'rematch_of', (select gs.rematch_of::text from public.game_sessions gs where gs.id = r.session_id), s::text);
  perform dsa_test.as_user(t);

  -- asking again returns the same room and role
  select * into r2 from public.dsa_rematch(s, false);
  perform dsa_test.eq(c, 'same room on a second call', r2.session_id::text, r.session_id::text);
  perform dsa_test.eq(c, 'same role on a second call', r2.role, 'DECOUVREUR');

  -- the other player accepts: joins that room, takes the free role, the game starts
  perform dsa_test.as_user(d);
  select * into r2 from public.dsa_rematch(s, false);
  perform dsa_test.eq(c, 'accepter joins the same room', r2.session_id::text, r.session_id::text);
  perform dsa_test.eq(c, 'accepter takes the free role', r2.role, 'TIREUR');
  perform dsa_test.eq(c, 'accepter room code', r2.room_code, r.room_code);
  st := public.dsa_get_state(r.session_id);
  perform dsa_test.eq(c, 'rematch starts', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'rematch waits for the new Tireur', st->>'tireur_ready', 'false');
  perform dsa_test.eq(c, 'accepter display name kept', st->'players'->0->>'display_name', 'Bill');
  perform dsa_test.check(c, (select count(*) from public.dsa_get_my_secret(r.session_id)) = 1, 'the new Tireur reads the new card');

  -- the room is full for anyone else, by code or by rematch
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select * from public.dsa_join_session(%L)', r.room_code), 'DSA_ROOM_FULL');

  -- only rooms between two players
  perform dsa_test.as_user(t);
  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR') cs;
  perform public.dsa_abandon(s);
  perform dsa_test.expect_error(c, format('select * from public.dsa_rematch(%L, false)', s), 'DSA_WRONG_MODE');

  perform dsa_test.as_postgres();
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_rematch(uuid,boolean)', 'execute'),
    'authenticated must be able to execute dsa_rematch');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_rematch(uuid,boolean)', 'execute'),
    'anon must not execute dsa_rematch');
end;
$$;



-- =============================================================================
-- 15. Timed games (0009): the clock, the settings snapshot, TIME_UP
-- =============================================================================
do $$
declare
  c        constant text := '15 timer: deadlines';
  u        uuid := dsa_test.u(1);
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  s        uuid;
  s2       uuid;
  v_code   text;
  st       jsonb;
  v_think  timestamptz;
  v_play   timestamptz;
  v_ready  timestamptz;
begin
  ---- an untimed game keeps the old behaviour, apart from the preparation phase
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', false);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'untimed: timed', st->>'timed', 'false');
  perform dsa_test.eq(c, 'untimed: phase', st->>'phase', 'THINKING');
  perform dsa_test.check(c, st->'think_ends_at' = 'null'::jsonb, 'untimed: no thinking deadline');
  perform dsa_test.check(c, st->'play_ends_at' = 'null'::jsonb, 'untimed: no game deadline');
  perform dsa_test.check(c, st->>'server_now' is not null, 'untimed: server_now is always sent');
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'untimed: phase after ready', st->>'phase', 'PLAYING');
  perform dsa_test.check(c, st->'play_ends_at' = 'null'::jsonb, 'untimed: still no game deadline');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');

  ---- a timed LOCAL game: the thinking clock starts at creation
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', false, '{"timed": true}'::jsonb);
  st := public.dsa_get_state(s);
  perform dsa_test.eq_json(c, 'timed settings', st->'settings', dsa_test.settings('BUTTONS', true));
  perform dsa_test.eq(c, 'timed: timed', st->>'timed', 'true');
  perform dsa_test.eq(c, 'timed: phase', st->>'phase', 'THINKING');
  perform dsa_test.eq(c, 'timed: redraws_used', st->>'redraws_used', '0');
  perform dsa_test.eq(c, 'timed: redraws_left', st->>'redraws_left', '2');
  perform dsa_test.eq(c, 'think_ends_at is now + think_seconds',
    (st->>'think_ends_at')::timestamptz::text, (now() + interval '40 seconds')::text);
  perform dsa_test.check(c, st->'play_ends_at' = 'null'::jsonb, 'the game clock waits for the end of the thinking time');
  perform dsa_test.eq(c, 'server_now is the server clock', (st->>'server_now')::timestamptz::text, now()::text);

  ---- "Je suis prêt" ends the thinking time early and fixes the game deadline
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'ready: phase', st->>'phase', 'PLAYING');
  perform dsa_test.eq(c, 'ready: think_ends_at moves to now', (st->>'think_ends_at')::timestamptz::text, now()::text);
  perform dsa_test.eq(c, 'play_ends_at is now + play_seconds',
    (st->>'play_ends_at')::timestamptz::text, (now() + interval '120 seconds')::text);
  v_play := (st->>'play_ends_at')::timestamptz;

  ---- nothing extends it: rewinds, going back and refused names all cost the same time
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform public.dsa_rewind(s, 1);
  perform dsa_test.play(c, s, 'HOMME', 'OUI');
  perform public.dsa_go_back(s, 0);
  perform public.dsa_guess(s, 'ABEL');
  perform public.dsa_confirm_guess(s, 'NON');
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'play_ends_at never moves', (st->>'play_ends_at')::timestamptz::text, v_play::text);

  ---- the thinking deadline ends the phase, and the game time starts from it
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', false, '{"timed": true}'::jsonb);
  perform dsa_test.as_postgres();
  update public.game_sessions gs set think_ends_at = now() - interval '3 seconds' where gs.id = s;
  select gs.think_ends_at into v_think from public.game_sessions gs where gs.id = s;
  perform dsa_test.as_user(u);
  st := public.dsa_check_time(s);
  perform dsa_test.eq(c, 'deadline: phase', st->>'phase', 'PLAYING');
  perform dsa_test.eq(c, 'deadline: tireur_ready', st->>'tireur_ready', 'true');
  perform dsa_test.eq(c, 'the game time starts at the thinking deadline, not at the check',
    (st->>'play_ends_at')::timestamptz::text, (v_think + interval '120 seconds')::text);
  perform dsa_test.as_postgres();
  select gs.tireur_ready_at into v_ready from public.game_sessions gs where gs.id = s;
  perform dsa_test.eq(c, 'ready at the deadline', v_ready::text, v_think::text);
  perform dsa_test.eq(c, 'one TIREUR_READY move, with its reason',
    (select string_agg(m.payload->>'reason', ',') from public.game_moves m
     where m.game_session_id = s and m.payload->>'event' = 'TIREUR_READY'), 'DEADLINE');
  perform dsa_test.as_user(u);
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');  -- the game really is on

  ---- in a room the clock only starts once both players are present
  s2 := dsa_test.new_session(t, 'HUMAN_VS_HUMAN', 'TIREUR', 'P/lie-a-adam/classe-1/le-meurtrier--cain', false, '{"timed": true}'::jsonb);
  st := public.dsa_get_state(s2);
  perform dsa_test.eq(c, 'room: WAITING', st->>'status', 'WAITING');
  perform dsa_test.check(c, st->'think_ends_at' = 'null'::jsonb, 'the room clock must not start before the second player');
  perform dsa_test.expect_error(c, format('select * from public.dsa_get_my_secret(%L)', s2), 'DSA_WAITING_FOR_PLAYER');
  v_code := st->>'room_code';
  perform dsa_test.as_user(d);
  perform public.dsa_join_session(v_code, 'Bill');
  perform dsa_test.as_user(t);
  st := public.dsa_get_state(s2);
  perform dsa_test.eq(c, 'room: PLAYING', st->>'status', 'PLAYING');
  perform dsa_test.eq(c, 'room: the thinking clock starts on the join',
    (st->>'think_ends_at')::timestamptz::text, (now() + interval '40 seconds')::text);
  perform dsa_test.check(c, (select count(*) from public.dsa_get_my_secret(s2)) = 1, 'the card is readable once both are there');

  ---- the AI Tireur has no preparation phase: the game time starts at once
  perform dsa_test.as_user(u);
  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR', null, null, '{"timed": true}'::jsonb) cs;
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'AI_TIREUR: phase', st->>'phase', 'PLAYING');
  perform dsa_test.check(c, st->'think_ends_at' = 'null'::jsonb, 'AI_TIREUR has no thinking time');
  perform dsa_test.eq(c, 'AI_TIREUR: play_ends_at',
    (st->>'play_ends_at')::timestamptz::text, (now() + interval '120 seconds')::text);
end;
$$;

do $$
declare
  c   constant text := '15 timer: app_settings';
  u   uuid := dsa_test.u(1);
  adm uuid := dsa_test.u(4);
  s   uuid;
  st  jsonb;
begin
  ---- the defaults of the single row
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'one row', (select count(*)::text from public.app_settings), '1');
  perform dsa_test.eq(c, 'defaults',
    (select format('%s/%s/%s', a.think_seconds, a.play_seconds, a.max_redraws) from public.dsa_app_settings() a),
    '40/120/2');

  ---- bounds
  perform dsa_test.expect_error(c, 'update public.app_settings set think_seconds = 9', '23514');
  perform dsa_test.expect_error(c, 'update public.app_settings set think_seconds = 601', '23514');
  perform dsa_test.expect_error(c, 'update public.app_settings set play_seconds = 29', '23514');
  perform dsa_test.expect_error(c, 'update public.app_settings set play_seconds = 1801', '23514');
  perform dsa_test.expect_error(c, 'update public.app_settings set max_redraws = -1', '23514');
  perform dsa_test.expect_error(c, 'update public.app_settings set max_redraws = 6', '23514');
  perform dsa_test.expect_error(c, 'insert into public.app_settings (id) values (false)', '23514');

  ---- RLS: an admin writes, a player does not
  perform dsa_test.as_user(u);
  perform dsa_test.eq(c, 'a player sees no settings row', (select count(*)::text from public.app_settings), '0');
  update public.app_settings set think_seconds = 90;
  perform dsa_test.eq(c, 'a player changes nothing',
    (select count(*)::text from public.app_settings a where a.think_seconds = 90), '0');
  perform dsa_test.expect_error(c, 'select * from public.dsa_app_settings()', '42501');

  perform dsa_test.as_user(adm);
  perform dsa_test.eq(c, 'an admin reads the row', (select count(*)::text from public.app_settings), '1');

  ---- a running game keeps the durations it was created with
  perform dsa_test.as_user(u);
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', false, '{"timed": true}'::jsonb);
  perform dsa_test.as_user(adm);
  update public.app_settings set think_seconds = 90, play_seconds = 300, max_redraws = 4;
  perform dsa_test.as_user(u);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'the running game keeps think_seconds', st->'settings'->>'think_seconds', '40');
  perform dsa_test.eq(c, 'the running game keeps play_seconds', st->'settings'->>'play_seconds', '120');
  perform dsa_test.eq(c, 'the running game keeps max_redraws', st->'settings'->>'max_redraws', '2');
  st := public.dsa_tireur_ready(s);
  perform dsa_test.eq(c, 'the running game uses its own play_seconds',
    (st->>'play_ends_at')::timestamptz::text, (now() + interval '120 seconds')::text);

  ---- a new game takes the new values
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', false, '{"timed": true}'::jsonb);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'a new game takes think_seconds', st->'settings'->>'think_seconds', '90');
  perform dsa_test.eq(c, 'a new game takes play_seconds', st->'settings'->>'play_seconds', '300');
  perform dsa_test.eq(c, 'a new game takes max_redraws', st->'settings'->>'max_redraws', '4');
  perform dsa_test.eq(c, 'a new game uses the new thinking time',
    (st->>'think_ends_at')::timestamptz::text, (now() + interval '90 seconds')::text);

  ---- an untimed game copies max_redraws but no duration
  s := dsa_test.new_session(u, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', false);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'untimed copies max_redraws', st->'settings'->>'max_redraws', '4');
  perform dsa_test.check(c, st->'settings'->'think_seconds' is null, 'an untimed game stores no durations');

  ---- dsa_timer_defaults: any player may read the durations (they are the rules
  ---- of the game, not a secret), so "Préparer la partie" can quote them.
  perform dsa_test.eq(c, 'a player reads the durations',
    public.dsa_timer_defaults()::text, dsa_test.timer_defaults()::text);
  perform dsa_test.eq(c, 'and they are the new ones', public.dsa_timer_defaults()->>'think_seconds', '90');

  ---- back to the defaults for the blocks that follow
  perform dsa_test.as_user(adm);
  update public.app_settings set think_seconds = 40, play_seconds = 120, max_redraws = 2;
  perform dsa_test.as_user(u);
  perform dsa_test.eq(c, 'the defaults again', public.dsa_timer_defaults()->>'play_seconds', '120');

  perform dsa_test.as_postgres();
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_timer_defaults()', 'execute'),
    'authenticated must be able to execute dsa_timer_defaults');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_timer_defaults()', 'execute'),
    'anon must not execute dsa_timer_defaults');
  perform dsa_test.as_user(u);
end;
$$;

do $$
declare
  c        constant text := '15 timer: TIME_UP';
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  s        uuid;
  s_ai     uuid;
  s_aid    uuid;
  st       jsonb;
  rp       jsonb;
  v_play   timestamptz;
begin
  ---- the deadline is checked before anything else, from every mutating RPC
  s := dsa_test.new_session(t, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', true, '{"timed": true}'::jsonb);
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform public.dsa_ask(s);  -- a question is waiting for its answer
  perform dsa_test.as_postgres();
  update public.game_sessions gs set play_ends_at = now() - interval '1 second' where gs.id = s;
  select gs.play_ends_at into v_play from public.game_sessions gs where gs.id = s;
  perform dsa_test.as_user(t);

  -- A move that arrives too late raises and changes nothing at all: the raise
  -- rolls its own transaction back, so the move never lands.
  perform dsa_test.expect_error(c, format('select public.dsa_answer(%L, %L)', s, 'OUI'), 'DSA_TIME_UP');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'a refused move records nothing',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.move_type = 'ANSWER'), '1');
  perform dsa_test.as_user(t);

  -- dsa_check_time is what writes TIME_UP down, for this device and the other one.
  st := public.dsa_check_time(s);
  perform dsa_test.eq(c, 'dsa_check_time records TIME_UP', st->>'status', 'TIME_UP');
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'status', (select gs.status from public.game_sessions gs where gs.id = s), 'TIME_UP');
  perform dsa_test.check(c, (select gs.winner is null from public.game_sessions gs where gs.id = s), 'nobody wins when the time is up');
  perform dsa_test.eq(c, 'awaiting', (select gs.awaiting from public.game_sessions gs where gs.id = s), 'NONE');
  perform dsa_test.eq(c, 'ended_at is the deadline itself',
    (select gs.ended_at::text from public.game_sessions gs where gs.id = s), v_play::text);
  perform dsa_test.eq(c, 'one TIME_UP move',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.payload->>'event' = 'TIME_UP'), '1');
  perform dsa_test.as_user(t);

  perform dsa_test.expect_error(c, format('select public.dsa_ask(%L)', s), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_guess(%L, %L)', s, 'CAÏN'), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_confirm_guess(%L, %L)', s, 'OUI'), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_go_back(%L, 0)', s), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_rewind(%L, 1)', s), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_tireur_ready(%L)', s), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_TIME_UP');
  perform dsa_test.expect_error(c, format('select public.dsa_abandon(%L)', s), 'DSA_TIME_UP');
  -- and it stays at exactly one TIME_UP move
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'still one TIME_UP move',
    (select count(*)::text from public.game_moves m where m.game_session_id = s and m.payload->>'event' = 'TIME_UP'), '1');
  perform dsa_test.as_user(t);

  ---- the end of a timed game reveals the name and the book's path, like any other
  rp := public.dsa_get_revealed_path(s);
  perform dsa_test.eq(c, 'revealed status', rp->>'status', 'TIME_UP');
  perform dsa_test.check(c, rp->'winner' = 'null'::jsonb, 'no winner');
  perform dsa_test.eq(c, 'revealed name', rp->'secret'->>'name', 'CAÏN');
  perform dsa_test.eq(c, 'stats.timed', rp->'stats'->>'timed', 'true');
  perform dsa_test.eq(c, 'stats.play_seconds', rp->'stats'->>'play_seconds', '120');
  perform dsa_test.check(c, rp->'stats'->'found_in_seconds' = 'null'::jsonb, 'nothing was found');
  perform dsa_test.check(c, jsonb_array_length(public.dsa_get_solution_path(s)->'path') > 0, 'the book path is available after TIME_UP');

  ---- dsa_check_time turns an idle game into TIME_UP without raising
  s := dsa_test.new_session(t, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', true, '{"timed": true}'::jsonb);
  perform dsa_test.as_postgres();
  update public.game_sessions gs set play_ends_at = now() - interval '1 second' where gs.id = s;
  perform dsa_test.as_user(t);
  st := public.dsa_check_time(s);
  perform dsa_test.eq(c, 'dsa_check_time reports TIME_UP', st->>'status', 'TIME_UP');
  perform dsa_test.check(c, st->'prompt' = 'null'::jsonb, 'no prompt once the time is up');
  st := public.dsa_check_time(s);
  perform dsa_test.eq(c, 'dsa_check_time is idempotent', st->>'status', 'TIME_UP');

  ---- an untimed game is never touched by the clock
  s := dsa_test.new_session(t, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', true);
  st := public.dsa_check_time(s);
  perform dsa_test.eq(c, 'untimed: dsa_check_time changes nothing', st->>'status', 'PLAYING');

  ---- the AI Découvreur also stops at the deadline
  perform dsa_test.as_user(t);
  select cs.session_id into s_aid from public.dsa_create_session('mini', 'AI_DECOUVREUR', null, null, '{"timed": true}'::jsonb) cs;
  perform public.dsa_tireur_ready(s_aid);
  perform dsa_test.as_postgres();
  update public.game_sessions gs set play_ends_at = now() - interval '1 second' where gs.id = s_aid;
  perform dsa_test.as_user(t);
  perform dsa_test.expect_error(c, format('select public.dsa_ai_decouvreur_step(%L)', s_aid), 'DSA_TIME_UP');

  ---- found_in_seconds on a discovered timed game
  s := dsa_test.new_session(t, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', true, '{"timed": true}'::jsonb);
  perform dsa_test.as_postgres();
  -- 72 seconds of game time have gone by (now() is frozen inside this transaction)
  update public.game_sessions gs set tireur_ready_at = now() - interval '72 seconds' where gs.id = s;
  perform dsa_test.as_user(t);
  perform public.dsa_guess(s, 'CAÏN');
  perform public.dsa_confirm_guess(s, 'OUI');
  rp := public.dsa_get_revealed_path(s);
  perform dsa_test.eq(c, 'discovered', rp->>'status', 'DISCOVERED');
  perform dsa_test.eq(c, 'found_in_seconds', rp->'stats'->>'found_in_seconds', '72');
  perform dsa_test.eq(c, 'out of play_seconds', rp->'stats'->>'play_seconds', '120');

  ---- privileges
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_check_time(uuid)', 'execute'),
    'authenticated must be able to execute dsa_check_time');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_check_time(uuid)', 'execute'),
    'anon must not execute dsa_check_time');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_app_settings()', 'execute'),
    'dsa_app_settings must stay internal');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_tick(public.game_sessions)', 'execute'),
    'dsa_tick must stay internal');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_end_thinking(public.game_sessions,timestamptz,text)', 'execute'),
    'dsa_end_thinking must stay internal');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_assert_time(public.game_sessions)', 'execute'),
    'dsa_assert_time must stay internal');
  perform dsa_test.check(c, not has_function_privilege('authenticated', 'public.dsa_solution_path(uuid,uuid)', 'execute'),
    'dsa_solution_path must stay internal');
end;
$$;


-- =============================================================================
-- 16. Changing the name before the start (0009)
-- =============================================================================
do $$
declare
  c        constant text := '16 redraw';
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  x        uuid := dsa_test.u(3);
  adm      uuid := dsa_test.u(4);
  s        uuid;
  v_code   text;
  st       jsonb;
  v_first  uuid;
  v_second uuid;
  v_third  uuid;
  v_names  text[];
  v_think  timestamptz;
  v_main   uuid;
begin
  ---- a timed LOCAL game: two changes, then no more
  s := dsa_test.new_session(t, 'LOCAL', null, null, false, '{"timed": true}'::jsonb);
  st := public.dsa_get_state(s);
  perform dsa_test.eq(c, 'redraws_used', st->>'redraws_used', '0');
  perform dsa_test.eq(c, 'redraws_left', st->>'redraws_left', '2');
  perform dsa_test.as_postgres();
  select gs.secret_node_id into v_first from public.game_secrets gs where gs.game_session_id = s;
  -- the thinking clock is about to be restarted, so move it out of the way first
  update public.game_sessions gs set think_ends_at = now() + interval '5 seconds' where gs.id = s;
  perform dsa_test.as_user(t);

  st := public.dsa_redraw_secret(s);
  perform dsa_test.eq(c, 'after one change: used', st->>'redraws_used', '1');
  perform dsa_test.eq(c, 'after one change: left', st->>'redraws_left', '1');
  perform dsa_test.eq(c, 'still in the preparation phase', st->>'phase', 'THINKING');
  perform dsa_test.eq(c, 'a new name gives a fresh thinking time',
    (st->>'think_ends_at')::timestamptz::text, (now() + interval '40 seconds')::text);
  perform dsa_test.as_postgres();
  select gs.secret_node_id into v_second from public.game_secrets gs where gs.game_session_id = s;
  perform dsa_test.check(c, v_second <> v_first, 'the card really changed');
  perform dsa_test.eq(c, 'the old name is remembered',
    (select gs.previous_node_ids::text from public.game_secrets gs where gs.game_session_id = s),
    ('{' || v_first::text || '}'));
  perform dsa_test.as_user(t);

  st := public.dsa_redraw_secret(s);
  perform dsa_test.eq(c, 'after two changes: used', st->>'redraws_used', '2');
  perform dsa_test.eq(c, 'after two changes: left', st->>'redraws_left', '0');
  perform dsa_test.as_postgres();
  select gs.secret_node_id into v_third from public.game_secrets gs where gs.game_session_id = s;
  perform dsa_test.check(c, v_third <> v_first and v_third <> v_second, 'a name already drawn never comes back');
  perform dsa_test.as_user(t);

  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_NO_REDRAW_LEFT');

  v_main := s;

  ---- a name already drawn never comes back, proved on a graph with two cards
  --   only: after ADAM the one name left is CAÏN, and then there is none.
  perform dsa_test.as_postgres();
  update public.graph_nodes n
  set review_status = 'DRAFT'
  where n.node_type = 'CHARACTER'
    and n.graph_id = (select g.id from public.graphs g where g.slug = 'mini')
    and n.id not in (dsa_test.nid('P/lie-a-adam/classe-1/premier-homme--adam'),
                     dsa_test.nid('P/lie-a-adam/classe-1/le-meurtrier--cain'));
  perform dsa_test.as_user(t);
  s := dsa_test.new_session(t, 'LOCAL', null, 'P/lie-a-adam/classe-1/premier-homme--adam', false);
  st := public.dsa_redraw_secret(s);
  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'the only other card is drawn',
    (select n.label from public.game_secrets gs join public.graph_nodes n on n.id = gs.secret_node_id
     where gs.game_session_id = s), 'CAÏN');
  perform dsa_test.as_user(t);
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_NO_PLAYABLE_SECRET');
  perform dsa_test.as_postgres();
  update public.graph_nodes n
  set review_status = 'APPROVED'
  where n.node_type = 'CHARACTER'
    and n.graph_id = (select g.id from public.graphs g where g.slug = 'mini');
  perform dsa_test.eq(c, 'the graph is restored',
    (select count(*)::text from public.graph_nodes n
     join public.graphs g on g.id = n.graph_id
     where g.slug = 'mini' and n.review_status = 'APPROVED'), '30');
  perform dsa_test.as_user(t);
  s := v_main;

  ---- nothing about the names leaks
  st := public.dsa_get_state(s);
  perform dsa_test.check(c, position(v_first::text in st::text) = 0, 'the first card leaked in the state');
  perform dsa_test.check(c, position(v_second::text in st::text) = 0, 'the second card leaked in the state');
  perform dsa_test.check(c, position(v_third::text in st::text) = 0, 'the current card leaked in the state');
  perform dsa_test.as_postgres();
  select array_agg(n.label) into v_names from public.graph_nodes n where n.id in (v_first, v_second, v_third);
  perform dsa_test.as_user(t);
  perform dsa_test.check(c, not exists (
    select 1 from unnest(v_names) nm where position(nm in public.dsa_get_state(s)::text) > 0
  ), 'a drawn name leaked in the state');
  perform dsa_test.as_postgres();
  perform dsa_test.eq_json(c, 'the REDRAW move says only that the name changed',
    (select m.payload from public.game_moves m
     where m.game_session_id = s and m.payload->>'event' = 'REDRAW' order by m.seq desc limit 1),
    '{"event": "REDRAW"}');
  perform dsa_test.check(c, not exists (
    select 1 from public.game_moves m
    where m.game_session_id = s and m.payload->>'event' = 'REDRAW' and m.node_id is not null
  ), 'a REDRAW move must carry no node');
  perform dsa_test.as_user(t);

  ---- once the questions have started, the name is fixed: only abandoning is left
  perform public.dsa_tireur_ready(s);
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_GAME_STARTED');
  perform dsa_test.play(c, s, 'ANCIEN', 'OUI');
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_GAME_STARTED');
  perform public.dsa_abandon(s);
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_GAME_OVER');

  ---- it works without the timer too (GAME_RULES, point 3)
  s := dsa_test.new_session(t, 'LOCAL', null, null, false);
  st := public.dsa_redraw_secret(s);
  perform dsa_test.eq(c, 'untimed: used', st->>'redraws_used', '1');
  perform dsa_test.check(c, st->'think_ends_at' = 'null'::jsonb, 'untimed: still no clock');

  ---- a room: only the Tireur, only before "Je suis prêt"
  s := dsa_test.new_session(t, 'HUMAN_VS_HUMAN', 'TIREUR', null, false);
  st := public.dsa_get_state(s);
  v_code := st->>'room_code';
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_WAITING_FOR_PLAYER');
  perform dsa_test.as_user(d);
  perform public.dsa_join_session(v_code, 'Bill');
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_WRONG_ROLE');
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_NOT_PLAYER');
  perform dsa_test.as_user(t);
  st := public.dsa_redraw_secret(s);
  perform dsa_test.eq(c, 'room: used', st->>'redraws_used', '1');
  -- the Découvreur is told that the name changed, and nothing else
  perform dsa_test.as_user(d);
  perform dsa_test.eq(c, 'the Découvreur sees the REDRAW event',
    (select count(*)::text from public.game_moves m
     where m.game_session_id = s and m.payload->>'event' = 'REDRAW'), '1');
  perform dsa_test.eq(c, 'the Découvreur still reads no secret row',
    (select count(*)::text from public.game_secrets gs where gs.game_session_id = s), '0');
  perform dsa_test.as_user(t);
  perform public.dsa_tireur_ready(s);
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_GAME_STARTED');

  ---- max_redraws = 0 turns the feature off
  perform dsa_test.as_user(adm);
  update public.app_settings set max_redraws = 0;
  perform dsa_test.as_user(t);
  s := dsa_test.new_session(t, 'LOCAL', null, null, false);
  perform dsa_test.eq(c, 'no change allowed', public.dsa_get_state(s)->>'redraws_left', '0');
  perform dsa_test.expect_error(c, format('select public.dsa_redraw_secret(%L)', s), 'DSA_NO_REDRAW_LEFT');
  perform dsa_test.as_user(adm);
  update public.app_settings set max_redraws = 2;
  perform dsa_test.as_user(t);

  ---- privileges
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_redraw_secret(uuid)', 'execute'),
    'authenticated must be able to execute dsa_redraw_secret');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_redraw_secret(uuid)', 'execute'),
    'anon must not execute dsa_redraw_secret');
end;
$$;


-- =============================================================================
-- 17. The book's path to the name (0009)
-- =============================================================================
do $$
declare
  c        constant text := '17 solution path';
  t        uuid := dsa_test.u(1);
  d        uuid := dsa_test.u(2);
  x        uuid := dsa_test.u(3);
  v_secret uuid;
  v_name   text;
  v_played uuid;
  v_solved uuid;
  v_path   jsonb;
  v_step   jsonb;
  st       jsonb;
  v_n      integer := 0;
  v_graph  uuid;
  v_cards  uuid[];
begin
  perform dsa_test.as_postgres();
  select g.id into v_graph from public.graphs g where g.slug = 'mini';
  select array_agg(pc.node_id order by pc.node_id) into v_cards
  from public.dsa_playable_characters(v_graph) pc;
  perform dsa_test.as_user(t);

  ---- every playable card of the mini graph
  foreach v_secret in array v_cards loop
    v_n := v_n + 1;
    perform dsa_test.as_postgres();
    select n.label into v_name from public.graph_nodes n where n.id = v_secret;

    -- one finished game, only to read the book's path for that card
    perform dsa_test.as_user(t);
    select cs.session_id into v_solved from public.dsa_create_session('mini', 'LOCAL') cs;
    perform dsa_test.as_postgres();
    update public.game_secrets gs
    set secret_node_id = v_secret,
        secret_character_id = (select n.character_id from public.graph_nodes n where n.id = v_secret)
    where gs.game_session_id = v_solved;
    perform dsa_test.as_user(t);
    perform public.dsa_abandon(v_solved);

    v_path := public.dsa_get_solution_path(v_solved);
    perform dsa_test.eq(c, v_name || ': secret name', v_path->'secret'->>'name', v_name);
    perform dsa_test.check(c, jsonb_array_length(v_path->'path') > 0, v_name || ': the path must not be empty');

    -- the same entry shape as path[] (so PathGraph renders it unchanged)
    for v_step in select * from jsonb_array_elements(v_path->'path') loop
      perform dsa_test.eq_json(c, v_name || ': entry keys',
        to_jsonb((select array_agg(k order by k) from jsonb_object_keys(v_step) k)),
        '["answer_label", "node_id", "node_type", "prompt_kind", "step_index", "target_text", "text"]');
      perform dsa_test.check(c,
        (v_step->>'prompt_kind' = 'SPINE') = (v_step->'target_text' <> 'null'::jsonb),
        v_name || ': only SPINE steps carry a target_text');
    end loop;

    -- and it really is the way there: replaying it in a second game reaches the card
    select cs.session_id into v_played from public.dsa_create_session('mini', 'LOCAL') cs;
    perform dsa_test.as_postgres();
    update public.game_secrets gs
    set secret_node_id = v_secret,
        secret_character_id = (select n.character_id from public.graph_nodes n where n.id = v_secret)
    where gs.game_session_id = v_played;
    perform dsa_test.as_user(t);
    perform public.dsa_tireur_ready(v_played);

    for v_step in select * from jsonb_array_elements(v_path->'path') loop
      perform dsa_test.eq(c, v_name || ': prompt at step ' || (v_step->>'step_index'),
        dsa_test.prompt(v_played), v_step->>'text');
      perform public.dsa_ask(v_played);
      perform public.dsa_answer(v_played, v_step->>'answer_label');
    end loop;

    st := public.dsa_get_state(v_played);
    perform dsa_test.check(c, st->'prompt' = 'null'::jsonb and st->>'dead_end' = 'false',
      v_name || ': the book path must end on the card, got ' || st::text);
    -- and on THAT card: following the book's answers lands exactly on the secret
    perform dsa_test.as_postgres();
    perform dsa_test.eq(c, v_name || ': the book path lands on the card itself',
      (select d.node_id::text from public.dsa_derive_position(v_played) d), v_secret::text);
    perform dsa_test.as_user(t);
    perform dsa_test.eq_json(c, v_name || ': the played path equals the book path', st->'path', v_path->'path');
    st := public.dsa_guess(v_played, v_name);
    perform public.dsa_confirm_guess(v_played, 'OUI');
    perform dsa_test.eq(c, v_name || ': discovered', public.dsa_get_state(v_played)->>'status', 'DISCOVERED');
    perform dsa_test.eq_json(c, v_name || ': same path after the end',
      public.dsa_get_solution_path(v_played)->'path', v_path->'path');
  end loop;

  perform dsa_test.eq(c, 'every playable card of mini was checked', v_n::text, '13');

  ---- refused before the end, and to outsiders
  perform dsa_test.as_user(t);
  v_played := dsa_test.new_session(t, 'LOCAL', null, 'P/lie-a-adam/classe-1/le-meurtrier--cain', true);
  perform dsa_test.expect_error(c, format('select public.dsa_get_solution_path(%L)', v_played), 'DSA_GAME_NOT_OVER');
  perform dsa_test.play(c, v_played, 'ANCIEN', 'OUI');
  perform dsa_test.expect_error(c, format('select public.dsa_get_solution_path(%L)', v_played), 'DSA_GAME_NOT_OVER');
  perform dsa_test.as_user(x);
  perform dsa_test.expect_error(c, format('select public.dsa_get_solution_path(%L)', v_played), 'DSA_NOT_PLAYER');
  perform dsa_test.as_user(t);
  perform public.dsa_abandon(v_played);
  perform dsa_test.eq(c, 'available after ABANDONED',
    public.dsa_get_solution_path(v_played)->'secret'->>'name', 'CAÏN');

  ---- a room: both players read it after the end
  v_played := dsa_test.new_session(t, 'HUMAN_VS_HUMAN', 'TIREUR', 'E/fils-de-zebedee--jacques', false);
  st := public.dsa_get_state(v_played);
  perform dsa_test.as_user(d);
  perform public.dsa_join_session(st->>'room_code', 'Bill');
  perform dsa_test.expect_error(c, format('select public.dsa_get_solution_path(%L)', v_played), 'DSA_GAME_NOT_OVER');
  perform public.dsa_abandon(v_played);
  perform dsa_test.eq(c, 'the Découvreur learns the book path too',
    public.dsa_get_solution_path(v_played)->'secret'->>'name', 'JACQUES');
  perform dsa_test.eq(c, 'a homonym is flagged on the book path',
    public.dsa_get_solution_path(v_played)->'secret'->>'has_homonyms', 'true');

  ---- privileges
  perform dsa_test.as_postgres();
  perform dsa_test.check(c, has_function_privilege('authenticated', 'public.dsa_get_solution_path(uuid)', 'execute'),
    'authenticated must be able to execute dsa_get_solution_path');
  perform dsa_test.check(c, not has_function_privilege('anon', 'public.dsa_get_solution_path(uuid)', 'execute'),
    'anon must not execute dsa_get_solution_path');
end;
$$;

-- =============================================================================
-- All blocks passed: remember it across the rollback with a session-level
-- advisory lock (rollback releases everything else), then roll back.
-- =============================================================================
do $$
begin
  perform dsa_test.as_postgres();
  perform pg_advisory_lock(20260915, 90);
end;
$$;

rollback;

-- Last select. Only prints PASSED if every block above ran without error.
select case
  when pg_advisory_unlock(20260915, 90) then 'ALL DSA TESTS PASSED'
  else 'DSA TESTS DID NOT COMPLETE: read the first error above'
end as result;
