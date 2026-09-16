-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0005_realtime.sql — Realtime publication for the game tables
--
-- Idempotent. Requires 0002.
-- Published: game_sessions, game_players, game_moves.
-- NEVER published: game_secrets (nor any graph table).
-- Clients react to a change by calling dsa_get_state(session_id).
-- Postgres Changes apply the SELECT policies of 0004, so each subscriber only
-- receives rows of sessions they play in.
-- =============================================================================

-- Old row values on UPDATE/DELETE (moves are updated when undone, sessions on
-- every transition).
alter table public.game_sessions replica identity full;
alter table public.game_players  replica identity full;
alter table public.game_moves    replica identity full;

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array['game_sessions', 'game_players', 'game_moves'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;

  -- Safety net: the secret table must never be in the publication.
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_secrets'
  ) then
    alter publication supabase_realtime drop table public.game_secrets;
  end if;
end;
$$;
