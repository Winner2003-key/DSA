-- =============================================================================
-- DSA — 94_voice_tests.sql — voice rate-limit tests (04_voice.sql)
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * Requires 04_voice.sql to have been run.
-- * Everything runs inside ONE transaction that is ROLLED BACK at the end:
--   test users, usage rows, the dsa_voice_test helper schema — nothing is kept.
-- * Expected final result: a single row  ALL DSA VOICE TESTS PASSED
--   Any failure stops the script with  DSA VOICE TEST FAILED [<block>]: <details>
--
-- Users are simulated like PostgREST does it: role `authenticated` plus
-- request.jwt.claims. Old usage rows are back-dated as the postgres role.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Preconditions
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_voice_consume(integer)') is null or to_regclass('public.voice_usage') is null then
    raise exception 'DSA VOICE TEST SETUP: run 04_voice.sql first';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Test helpers (schema dsa_voice_test, rolled back with everything else)
-- -----------------------------------------------------------------------------
create schema dsa_voice_test;

create function dsa_voice_test.u(p_n integer) returns uuid
language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000094a' || p_n)::uuid;
$$;

create function dsa_voice_test.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create function dsa_voice_test.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

create function dsa_voice_test.as_postgres() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function dsa_voice_test.fail(p_block text, p_message text) returns void
language plpgsql as $$
begin
  raise exception 'DSA VOICE TEST FAILED [%]: %', p_block, p_message;
end;
$$;

create function dsa_voice_test.check(p_block text, p_ok boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    perform dsa_voice_test.fail(p_block, p_message);
  end if;
end;
$$;

create function dsa_voice_test.eq(p_block text, p_what text, p_actual text, p_expected text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    perform dsa_voice_test.fail(p_block, format('%s: expected %L, got %L', p_what, p_expected, p_actual));
  end if;
end;
$$;

-- Runs p_sql and requires an error whose message starts with p_expected
-- (a DSA_* code) or whose SQLSTATE equals p_expected (e.g. 42501).
create function dsa_voice_test.expect_error(p_block text, p_sql text, p_expected text) returns text
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
    perform dsa_voice_test.fail(p_block, format('expected error %s from [%s], but it succeeded', p_expected, p_sql));
  elsif not (v_message like p_expected || '%' or v_state = p_expected) then
    perform dsa_voice_test.fail(p_block, format('expected error %s from [%s], got [%s] %s', p_expected, p_sql, v_state, v_message));
  end if;
  return v_message;
end;
$$;

-- Usage rows of a user (SECURITY DEFINER: reads the table whatever the current role).
create function dsa_voice_test.rows(p_user uuid) returns integer
language sql security definer set search_path = public, pg_temp as $$
  select count(*)::integer from public.voice_usage where user_id = p_user;
$$;

grant usage on schema dsa_voice_test to anon, authenticated;
grant execute on all functions in schema dsa_voice_test to anon, authenticated;

insert into auth.users (id, aud, role, email) values
  (dsa_voice_test.u(1), 'authenticated', 'authenticated', 'dsa-voice-test-1@example.invalid'),
  (dsa_voice_test.u(2), 'authenticated', 'authenticated', 'dsa-voice-test-2@example.invalid'),
  (dsa_voice_test.u(3), 'authenticated', 'authenticated', 'dsa-voice-test-3@example.invalid'),
  (dsa_voice_test.u(4), 'authenticated', 'authenticated', 'dsa-voice-test-4@example.invalid');


-- =============================================================================
-- Block 1 — structure and privileges
-- =============================================================================
do $$
declare
  c constant text := '1 privileges';
begin
  perform dsa_voice_test.as_postgres();
  perform dsa_voice_test.check(c, (select relrowsecurity from pg_class where oid = 'public.voice_usage'::regclass),
    'RLS must be enabled on voice_usage');
  perform dsa_voice_test.eq(c, 'policies on voice_usage',
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'voice_usage')::text, '0');
  perform dsa_voice_test.check(c, (select prosecdef from pg_proc where oid = 'public.dsa_voice_consume(integer)'::regprocedure),
    'dsa_voice_consume must be SECURITY DEFINER');
  perform dsa_voice_test.check(c,
    (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid = 'public.dsa_voice_consume(integer)'::regprocedure),
    'dsa_voice_consume must pin search_path');
  perform dsa_voice_test.check(c, to_regclass('public.voice_usage_user_at_idx') is not null, 'index voice_usage_user_at_idx missing');

  perform dsa_voice_test.check(c, has_function_privilege('authenticated', 'public.dsa_voice_consume(integer)', 'execute'),
    'authenticated must be able to execute dsa_voice_consume');
  perform dsa_voice_test.check(c, not has_function_privilege('anon', 'public.dsa_voice_consume(integer)', 'execute'),
    'anon must not execute dsa_voice_consume');
  perform dsa_voice_test.check(c, not has_table_privilege('authenticated', 'public.voice_usage', 'select'),
    'authenticated must not read voice_usage');
  perform dsa_voice_test.check(c, not has_table_privilege('authenticated', 'public.voice_usage', 'insert'),
    'authenticated must not write voice_usage');
  perform dsa_voice_test.check(c, not has_table_privilege('anon', 'public.voice_usage', 'select'),
    'anon must not read voice_usage');

  perform dsa_voice_test.as_user(dsa_voice_test.u(1));
  perform dsa_voice_test.expect_error(c, 'select count(*) from public.voice_usage', '42501');
  perform dsa_voice_test.expect_error(c,
    format('insert into public.voice_usage (user_id, audio_ms) values (%L, 1)', dsa_voice_test.u(1)), '42501');
  perform dsa_voice_test.as_anon();
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(1000)', '42501');
  perform dsa_voice_test.as_postgres();
end;
$$;


-- =============================================================================
-- Block 2 — authentication and input
-- =============================================================================
do $$
declare
  c constant text := '2 input';
begin
  -- `authenticated` role but no user in the JWT.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(1000)', 'DSA_NOT_AUTHENTICATED');

  perform dsa_voice_test.as_user(dsa_voice_test.u(1));
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(0)', 'DSA_VOICE_INVALID_AUDIO');
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(-5)', 'DSA_VOICE_INVALID_AUDIO');
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(30001)', 'DSA_VOICE_INVALID_AUDIO');
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(null)', 'DSA_VOICE_INVALID_AUDIO');
  perform dsa_voice_test.eq(c, 'rows after refused calls', dsa_voice_test.rows(dsa_voice_test.u(1))::text, '0');
  perform dsa_voice_test.as_postgres();
end;
$$;


-- =============================================================================
-- Block 3 — accepted call: return value and recorded row
-- =============================================================================
do $$
declare
  c constant text := '3 accepted';
  v jsonb;
begin
  perform dsa_voice_test.as_user(dsa_voice_test.u(4));
  v := public.dsa_voice_consume(1500);
  perform dsa_voice_test.eq(c, 'requests_left', v ->> 'requests_left', '39');
  perform dsa_voice_test.eq(c, 'audio_ms_left', v ->> 'audio_ms_left', '898500');
  v := public.dsa_voice_consume(30000);
  perform dsa_voice_test.eq(c, 'requests_left (2nd)', v ->> 'requests_left', '38');
  perform dsa_voice_test.eq(c, 'audio_ms_left (2nd)', v ->> 'audio_ms_left', '868500');
  perform dsa_voice_test.as_postgres();
  perform dsa_voice_test.eq(c, 'rows of user 4', dsa_voice_test.rows(dsa_voice_test.u(4))::text, '2');
  perform dsa_voice_test.eq(c, 'audio of user 4',
    (select sum(audio_ms) from public.voice_usage where user_id = dsa_voice_test.u(4))::text, '31500');
end;
$$;


-- =============================================================================
-- Block 4 — 40 requests per 10 minutes
-- =============================================================================
do $$
declare
  c constant text := '4 request limit';
  v jsonb;
  v_message text;
begin
  perform dsa_voice_test.as_user(dsa_voice_test.u(1));
  for i in 1..40 loop
    v := public.dsa_voice_consume(1000);
  end loop;
  perform dsa_voice_test.eq(c, 'requests_left after 40', v ->> 'requests_left', '0');
  v_message := dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(1000)', 'DSA_VOICE_RATE_LIMIT');
  perform dsa_voice_test.check(c, v_message like '%40 requests per 10 minutes; retry in % s', 'message: ' || v_message);
  perform dsa_voice_test.eq(c, 'rows of user 1 (the refused call is not recorded)', dsa_voice_test.rows(dsa_voice_test.u(1))::text, '40');

  -- Another user is not affected.
  perform dsa_voice_test.as_user(dsa_voice_test.u(2));
  v := public.dsa_voice_consume(1000);
  perform dsa_voice_test.eq(c, 'user 2 requests_left', v ->> 'requests_left', '39');

  -- 10 minutes later the window is free again.
  perform dsa_voice_test.as_postgres();
  update public.voice_usage set at = now() - interval '11 minutes' where user_id = dsa_voice_test.u(1);
  perform dsa_voice_test.as_user(dsa_voice_test.u(1));
  v := public.dsa_voice_consume(1000);
  perform dsa_voice_test.eq(c, 'requests_left after the window', v ->> 'requests_left', '39');
  -- The old rows still count toward the 24-hour audio budget.
  perform dsa_voice_test.eq(c, 'audio_ms_left after the window', v ->> 'audio_ms_left', '859000');
  perform dsa_voice_test.as_postgres();
end;
$$;


-- =============================================================================
-- Block 5 — 900 s of audio per 24 hours
-- =============================================================================
do $$
declare
  c constant text := '5 audio limit';
  v jsonb;
  v_message text;
begin
  perform dsa_voice_test.as_user(dsa_voice_test.u(3));
  for i in 1..30 loop
    v := public.dsa_voice_consume(30000);
  end loop;
  perform dsa_voice_test.eq(c, 'audio_ms_left after 900 s', v ->> 'audio_ms_left', '0');
  v_message := dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(1)', 'DSA_VOICE_RATE_LIMIT');
  perform dsa_voice_test.check(c, v_message like '%900 s of audio per 24 hours; retry in % s', 'message: ' || v_message);

  -- Rows older than 24 hours no longer count (and the 10-minute window is free too).
  perform dsa_voice_test.as_postgres();
  update public.voice_usage set at = now() - interval '25 hours'
   where id in (select id from public.voice_usage where user_id = dsa_voice_test.u(3) order by id limit 2);
  update public.voice_usage set at = now() - interval '20 minutes'
   where user_id = dsa_voice_test.u(3) and at > now() - interval '1 hour';
  perform dsa_voice_test.as_user(dsa_voice_test.u(3));
  v := public.dsa_voice_consume(30000);
  perform dsa_voice_test.eq(c, 'audio_ms_left after 2 rows expired', v ->> 'audio_ms_left', '30000');
  v := public.dsa_voice_consume(29999);
  perform dsa_voice_test.eq(c, 'audio_ms_left, 1 ms left', v ->> 'audio_ms_left', '1');
  perform dsa_voice_test.expect_error(c, 'select public.dsa_voice_consume(2)', 'DSA_VOICE_RATE_LIMIT');
  v := public.dsa_voice_consume(1);
  perform dsa_voice_test.eq(c, 'the last millisecond fits', v ->> 'audio_ms_left', '0');
  perform dsa_voice_test.as_postgres();
end;
$$;


-- =============================================================================
-- Block 6 — rows older than 2 days are cleaned up on the next call
-- =============================================================================
do $$
declare
  c constant text := '6 cleanup';
begin
  perform dsa_voice_test.as_postgres();
  insert into public.voice_usage (user_id, at, audio_ms)
  values (dsa_voice_test.u(2), now() - interval '3 days', 5000),
         (dsa_voice_test.u(2), now() - interval '50 hours', 5000);
  perform dsa_voice_test.as_user(dsa_voice_test.u(2));
  perform public.dsa_voice_consume(1000);
  perform dsa_voice_test.as_postgres();
  perform dsa_voice_test.eq(c, 'rows of user 2 older than 2 days',
    (select count(*) from public.voice_usage where user_id = dsa_voice_test.u(2) and at < now() - interval '2 days')::text, '0');
  perform dsa_voice_test.eq(c, 'rows of user 2', dsa_voice_test.rows(dsa_voice_test.u(2))::text, '2');
end;
$$;


-- =============================================================================
-- All blocks passed: remember it across the rollback with a session-level
-- advisory lock (rollback releases everything else), then roll back.
-- =============================================================================
do $$
begin
  perform dsa_voice_test.as_postgres();
  perform pg_advisory_lock(20260916, 94);
end;
$$;

rollback;

-- Last select. Only prints PASSED if every block above ran without error.
select case
  when pg_advisory_unlock(20260916, 94) then 'ALL DSA VOICE TESTS PASSED'
  else 'DSA VOICE TESTS DID NOT COMPLETE: read the first error above'
end as result;
