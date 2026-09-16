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
-- homonyms, path fields, stats, session settings).
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
create function dsa_test.path_fields(p_path jsonb) returns text
language sql immutable as $$
  select coalesce(string_agg(
    (x->>'text') || ':' || coalesce(x->>'prompt_kind', '?') || ':' || coalesce(x->>'node_type', '?') || ':' || coalesce(x->>'target_text', '-'),
    ' > ' order by (x->>'step_index')::integer), '')
  from jsonb_array_elements(p_path) x;
$$;

-- Creates a session as p_user and (test-only) forces its secret as postgres.
create function dsa_test.new_session(p_user uuid, p_mode text, p_role text, p_secret_key text) returns uuid
language plpgsql as $$
declare
  v_session uuid;
  v_secret  uuid;
begin
  perform dsa_test.as_user(p_user);
  select c.session_id into v_session from public.dsa_create_session('mini', p_mode, p_role, 'Test') c;

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
  perform dsa_test.eq(c, 'stats (0006)', rp->>'stats', '{"non": 1, "backs": 0, "rewinds": 0, "questions": 7}');
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
  perform dsa_test.eq(c, 'stats (0006)', rp->>'stats', '{"non": 2, "backs": 0, "rewinds": 1, "questions": 8}');

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
  perform dsa_test.eq(c, 'stats (0006)', public.dsa_get_revealed_path(s)->>'stats',
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
  perform dsa_test.eq(c, 'default settings', st->>'settings', '{"input_mode": "BUTTONS"}');

  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR', null, null, '{}'::jsonb) cs;
  perform dsa_test.eq(c, 'empty settings', public.dsa_get_state(s)->>'settings', '{"input_mode": "BUTTONS"}');

  select cs.session_id into s from public.dsa_create_session('mini', 'AI_TIREUR', null, null, null) cs;
  perform dsa_test.eq(c, 'null settings', public.dsa_get_state(s)->>'settings', '{"input_mode": "BUTTONS"}');

  ---- explicit values, by named argument like supabase-js sends them
  select cs.session_id into s from public.dsa_create_session(
    p_graph_slug => 'mini', p_mode => 'HUMAN_VS_HUMAN', p_role => 'TIREUR', p_display_name => 'Awa',
    p_settings => '{"input_mode": "VOICE"}'::jsonb) cs;
  perform dsa_test.eq(c, 'VOICE', public.dsa_get_state(s)->>'settings', '{"input_mode": "VOICE"}');

  select cs.session_id into s from public.dsa_create_session('mini', 'LOCAL', null, null, '{"input_mode": "BUTTONS"}') cs;
  perform dsa_test.eq(c, 'BUTTONS', public.dsa_get_state(s)->>'settings', '{"input_mode": "BUTTONS"}');

  perform dsa_test.as_postgres();
  perform dsa_test.eq(c, 'stored column', (select gs.settings::text from public.game_sessions gs where gs.id = s), '{"input_mode": "BUTTONS"}');
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
