-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0004_rls.sql — row level security and table privileges
--
-- Idempotent. Requires 0001–0003 (policies call the dsa_* helpers).
--
-- Model:
--   * graph tables: admins (admin_users) get full CRUD, nobody else sees anything;
--   * game tables: players of a session can SELECT; every write goes through
--     the SECURITY DEFINER RPCs in 0003, so clients have no INSERT/UPDATE/DELETE;
--   * game_secrets: SELECT only for the session's TIREUR;
--   * game_messages: players read, and insert their own;
--   * the anon role (not signed in) has no table access at all. Anonymous
--     sign-ins are the `authenticated` role.
-- Policies use SECURITY DEFINER helpers, which read game_players / admin_users
-- as the table owner, so there is no policy recursion.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.graphs            enable row level security;
alter table public.graph_versions    enable row level security;
alter table public.bible_characters  enable row level security;
alter table public.graph_nodes       enable row level security;
alter table public.graph_edges       enable row level security;
alter table public.admin_users       enable row level security;
alter table public.import_batches    enable row level security;
alter table public.game_sessions     enable row level security;
alter table public.game_players      enable row level security;
alter table public.game_moves        enable row level security;
alter table public.game_messages     enable row level security;
alter table public.game_secrets      enable row level security;

-- -----------------------------------------------------------------------------
-- Table privileges (defense in depth on top of RLS)
-- Supabase grants everything to anon/authenticated by default; narrow that.
-- -----------------------------------------------------------------------------
revoke all on table
  public.graphs, public.graph_versions, public.bible_characters, public.graph_nodes,
  public.graph_edges, public.admin_users, public.import_batches, public.game_sessions,
  public.game_players, public.game_moves, public.game_messages, public.game_secrets
from anon;

-- Graph tables: authenticated may try; RLS lets only admins through.
grant select, insert, update, delete on table
  public.graphs, public.graph_versions, public.bible_characters, public.graph_nodes,
  public.graph_edges, public.import_batches
to authenticated;

-- Read-only for clients.
revoke insert, update, delete, truncate on table
  public.admin_users, public.game_sessions, public.game_players, public.game_moves, public.game_secrets
from authenticated;
grant select on table
  public.admin_users, public.game_sessions, public.game_players, public.game_moves, public.game_secrets
to authenticated;

-- Messages: read and insert only.
revoke update, delete, truncate on table public.game_messages from authenticated;
grant select, insert on table public.game_messages to authenticated;

-- Local import scripts use the service role (bypasses RLS).
grant all on table
  public.graphs, public.graph_versions, public.bible_characters, public.graph_nodes,
  public.graph_edges, public.admin_users, public.import_batches, public.game_sessions,
  public.game_players, public.game_moves, public.game_messages, public.game_secrets
to service_role;

-- -----------------------------------------------------------------------------
-- Graph tables: admins only
-- -----------------------------------------------------------------------------
drop policy if exists graphs_admin_all on public.graphs;
create policy graphs_admin_all on public.graphs
  for all to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

drop policy if exists graph_versions_admin_all on public.graph_versions;
create policy graph_versions_admin_all on public.graph_versions
  for all to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

drop policy if exists bible_characters_admin_all on public.bible_characters;
create policy bible_characters_admin_all on public.bible_characters
  for all to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

drop policy if exists graph_nodes_admin_all on public.graph_nodes;
create policy graph_nodes_admin_all on public.graph_nodes
  for all to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

drop policy if exists graph_edges_admin_all on public.graph_edges;
create policy graph_edges_admin_all on public.graph_edges
  for all to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

drop policy if exists import_batches_admin_all on public.import_batches;
create policy import_batches_admin_all on public.import_batches
  for all to authenticated
  using (public.dsa_is_admin())
  with check (public.dsa_is_admin());

-- -----------------------------------------------------------------------------
-- admin_users: admins can read the list. Rows are added with 02_make_admin.sql.
-- -----------------------------------------------------------------------------
drop policy if exists admin_users_admin_select on public.admin_users;
create policy admin_users_admin_select on public.admin_users
  for select to authenticated
  using (public.dsa_is_admin());

-- -----------------------------------------------------------------------------
-- Game tables: session players can read; no client writes
-- -----------------------------------------------------------------------------
drop policy if exists game_sessions_player_select on public.game_sessions;
create policy game_sessions_player_select on public.game_sessions
  for select to authenticated
  using (public.dsa_is_session_player(id));

drop policy if exists game_players_player_select on public.game_players;
create policy game_players_player_select on public.game_players
  for select to authenticated
  using (public.dsa_is_session_player(game_session_id));

drop policy if exists game_moves_player_select on public.game_moves;
create policy game_moves_player_select on public.game_moves
  for select to authenticated
  using (public.dsa_is_session_player(game_session_id));

-- -----------------------------------------------------------------------------
-- game_secrets: the TIREUR of that session only
-- -----------------------------------------------------------------------------
drop policy if exists game_secrets_tireur_select on public.game_secrets;
create policy game_secrets_tireur_select on public.game_secrets
  for select to authenticated
  using (public.dsa_player_role(game_session_id) = 'TIREUR');

-- -----------------------------------------------------------------------------
-- game_messages: players read; players insert their own
-- -----------------------------------------------------------------------------
drop policy if exists game_messages_player_select on public.game_messages;
create policy game_messages_player_select on public.game_messages
  for select to authenticated
  using (public.dsa_is_session_player(game_session_id));

drop policy if exists game_messages_player_insert on public.game_messages;
create policy game_messages_player_insert on public.game_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.dsa_is_session_player(game_session_id)
  );
