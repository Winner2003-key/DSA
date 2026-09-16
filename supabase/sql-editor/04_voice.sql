-- =============================================================================
-- DSA — 04_voice.sql — voice rate limit (for the `transcribe` Edge Function)
--
-- * Paste the WHOLE file into Supabase → SQL Editor and click Run.
-- * Run it after 00 (and 03 if your project needed it). Needed before the
--   `transcribe` function can answer (VOICE.md, step 3).
-- * Safe to run more than once.
-- * Expected result: "Success. No rows returned". Then run 94_voice_tests.sql:
--   one row, ALL DSA VOICE TESTS PASSED.
--
-- Same content as supabase/migrations/0007_voice.sql (keep them identical).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. voice_usage: one row per accepted transcription request
-- -----------------------------------------------------------------------------
-- No client access at all: RLS on, no policy, privileges revoked. Only
-- dsa_voice_consume (SECURITY DEFINER) reads and writes it.
create table if not exists public.voice_usage (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  at        timestamptz not null default now(),
  audio_ms  integer not null,
  constraint voice_usage_audio_ms_check check (audio_ms between 1 and 30000)
);

create index if not exists voice_usage_user_at_idx on public.voice_usage (user_id, at);

alter table public.voice_usage enable row level security;

-- Supabase grants everything to anon/authenticated by default; take it back.
revoke all on table public.voice_usage from public, anon, authenticated;
revoke all on sequence public.voice_usage_id_seq from public, anon, authenticated;
grant all on table public.voice_usage to service_role;
grant all on sequence public.voice_usage_id_seq to service_role;

-- -----------------------------------------------------------------------------
-- 2. dsa_voice_consume(p_audio_ms): per-user rate limit, called by the
--    `transcribe` Edge Function with the user's JWT before any provider call
-- -----------------------------------------------------------------------------
-- Limits (edit the constants below, then run this file again):
--   * 40 requests per rolling 10 minutes;
--   * 900 s (900 000 ms) of audio per rolling 24 hours.
-- A refused call records nothing. Rows older than 2 days are deleted as the
-- user makes new calls, so the table stays small.
-- Returns {"requests_left": n, "audio_ms_left": n}.
-- Errors: DSA_NOT_AUTHENTICATED, DSA_VOICE_INVALID_AUDIO,
--         DSA_VOICE_RATE_LIMIT: …; retry in <seconds> s
create or replace function public.dsa_voice_consume(p_audio_ms integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_max_requests  constant integer  := 40;
  c_request_win   constant interval := interval '10 minutes';
  c_max_audio_ms  constant integer  := 900000;
  c_audio_win     constant interval := interval '24 hours';
  c_keep          constant interval := interval '2 days';
  v_uid      uuid := auth.uid();
  v_now      timestamptz := now();
  v_requests integer;
  v_oldest   timestamptz;
  v_audio    bigint;
  v_free_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'DSA_NOT_AUTHENTICATED: sign in first';
  end if;
  if p_audio_ms is null or p_audio_ms < 1 or p_audio_ms > 30000 then
    raise exception 'DSA_VOICE_INVALID_AUDIO: audio length must be 1..30000 ms (got %)', coalesce(p_audio_ms::text, 'null');
  end if;

  -- One call at a time per user, so parallel requests can't overrun the limits.
  perform pg_advisory_xact_lock(hashtext('dsa_voice_consume'), hashtext(v_uid::text));

  select count(*), min(u.at)
    into v_requests, v_oldest
    from public.voice_usage u
   where u.user_id = v_uid and u.at > v_now - c_request_win;

  if v_requests >= c_max_requests then
    raise exception 'DSA_VOICE_RATE_LIMIT: % requests per 10 minutes; retry in % s',
      c_max_requests,
      greatest(1, ceil(extract(epoch from (v_oldest + c_request_win - v_now))))::integer;
  end if;

  select coalesce(sum(u.audio_ms), 0)
    into v_audio
    from public.voice_usage u
   where u.user_id = v_uid and u.at > v_now - c_audio_win;

  if v_audio + p_audio_ms > c_max_audio_ms then
    -- When enough of the oldest audio leaves the 24-hour window.
    select min(s.at) into v_free_at
      from (
        select u.at, sum(u.audio_ms) over (order by u.at, u.id) as freed
          from public.voice_usage u
         where u.user_id = v_uid and u.at > v_now - c_audio_win
      ) s
     where s.freed >= v_audio + p_audio_ms - c_max_audio_ms;
    raise exception 'DSA_VOICE_RATE_LIMIT: % s of audio per 24 hours; retry in % s',
      c_max_audio_ms / 1000,
      greatest(1, ceil(extract(epoch from (coalesce(v_free_at, v_now) + c_audio_win - v_now))))::integer;
  end if;

  delete from public.voice_usage u where u.user_id = v_uid and u.at < v_now - c_keep;

  insert into public.voice_usage (user_id, at, audio_ms) values (v_uid, v_now, p_audio_ms);

  return jsonb_build_object(
    'requests_left', c_max_requests - v_requests - 1,
    'audio_ms_left', c_max_audio_ms - v_audio - p_audio_ms
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Privileges: signed-in users only (anonymous sign-ins are `authenticated`)
-- -----------------------------------------------------------------------------
revoke all on function public.dsa_voice_consume(integer) from public, anon;
grant execute on function public.dsa_voice_consume(integer) to authenticated, service_role;
