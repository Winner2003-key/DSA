-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0001_graph_schema.sql — graph tables (admin-only), characters, imports
--
-- Idempotent: safe to run again on a project that already has these objects.
-- Contract: GRAPH_SPECIFICATION.md §2 and §3.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- -----------------------------------------------------------------------------
-- updated_at trigger function (shared by every table with an updated_at column)
-- -----------------------------------------------------------------------------
create or replace function public.dsa_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- graphs
-- -----------------------------------------------------------------------------
create table if not exists public.graphs (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  name            text not null,
  description     text,
  version         integer not null default 1,
  is_active       boolean not null default true,
  status          text not null default 'DRAFT',
  source_document text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint graphs_slug_key unique (slug),
  constraint graphs_status_check check (status in ('DRAFT', 'PUBLISHED')),
  constraint graphs_version_check check (version >= 1)
);

-- -----------------------------------------------------------------------------
-- graph_versions: published snapshots of a graph
-- -----------------------------------------------------------------------------
create table if not exists public.graph_versions (
  id         uuid primary key default gen_random_uuid(),
  graph_id   uuid not null references public.graphs (id) on delete cascade,
  version    integer not null,
  status     text not null default 'DRAFT',
  snapshot   jsonb not null default '{}'::jsonb,
  notes      text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint graph_versions_graph_version_key unique (graph_id, version),
  constraint graph_versions_status_check check (status in ('DRAFT', 'PUBLISHED'))
);

-- -----------------------------------------------------------------------------
-- bible_characters: one row per person (the card), shared by alias leaves
-- -----------------------------------------------------------------------------
create table if not exists public.bible_characters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_fr     text,
  name_en     text,
  gender      text,
  testament   text,
  description text,
  aliases     text[] not null default '{}'::text[],
  is_active   boolean not null default true,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bible_characters_gender_check check (gender is null or gender in ('M', 'F')),
  constraint bible_characters_testament_check check (testament is null or testament in ('ANCIEN', 'NOUVEAU'))
);

-- -----------------------------------------------------------------------------
-- graph_nodes
-- -----------------------------------------------------------------------------
create table if not exists public.graph_nodes (
  id            uuid primary key default gen_random_uuid(),
  graph_id      uuid not null references public.graphs (id) on delete cascade,
  node_key      text not null,
  node_type     text not null,
  label         text not null,
  question      text,
  description   text,
  character_id  uuid references public.bible_characters (id) on delete set null,
  source_page   integer,
  position_x    double precision,
  position_y    double precision,
  review_status text not null default 'NEEDS_REVIEW',
  review_note   text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint graph_nodes_graph_node_key_key unique (graph_id, node_key),
  constraint graph_nodes_node_type_check check (
    node_type in ('START', 'QUESTION', 'CATEGORY', 'GROUP', 'CHARACTER', 'REFERENCE', 'END')
  ),
  constraint graph_nodes_review_status_check check (
    review_status in ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')
  ),
  constraint graph_nodes_group_kind_check check (
    metadata->>'group_kind' is null or metadata->>'group_kind' in ('CLASSE', 'TOME', 'ALIAS', 'OTHER')
  )
);

create index if not exists graph_nodes_graph_id_idx on public.graph_nodes (graph_id);
create index if not exists graph_nodes_character_id_idx on public.graph_nodes (character_id);
create index if not exists graph_nodes_graph_type_idx on public.graph_nodes (graph_id, node_type);

-- -----------------------------------------------------------------------------
-- graph_edges
-- -----------------------------------------------------------------------------
create table if not exists public.graph_edges (
  id            uuid primary key default gen_random_uuid(),
  graph_id      uuid not null references public.graphs (id) on delete cascade,
  from_node_id  uuid not null references public.graph_nodes (id) on delete cascade,
  to_node_id    uuid not null references public.graph_nodes (id) on delete cascade,
  answer_label  text not null,
  edge_kind     text not null,
  order_index   integer not null default 0,
  source_page   integer,
  review_status text not null default 'NEEDS_REVIEW',
  review_note   text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint graph_edges_edge_kind_check check (edge_kind in ('DECISION', 'HIERARCHY', 'SYSTEM')),
  constraint graph_edges_review_status_check check (
    review_status in ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')
  ),
  constraint graph_edges_no_self_loop_check check (from_node_id <> to_node_id)
);

create index if not exists graph_edges_graph_id_idx on public.graph_edges (graph_id);
create index if not exists graph_edges_from_node_id_idx on public.graph_edges (from_node_id);
create index if not exists graph_edges_to_node_id_idx on public.graph_edges (to_node_id);
create index if not exists graph_edges_from_order_idx on public.graph_edges (from_node_id, order_index);

-- -----------------------------------------------------------------------------
-- admin_users
-- -----------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- import_batches: one row per importer run, reviewed in the admin
-- -----------------------------------------------------------------------------
create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  graph_id    uuid references public.graphs (id) on delete cascade,
  graph_slug  text not null,
  source      text,
  status      text not null default 'PENDING',
  stats       jsonb not null default '{}'::jsonb,
  report      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  applied_at  timestamptz,
  constraint import_batches_status_check check (
    status in ('PENDING', 'VALIDATED', 'APPLIED', 'FAILED', 'DISCARDED')
  )
);

create index if not exists import_batches_graph_id_idx on public.import_batches (graph_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
drop trigger if exists graphs_set_updated_at on public.graphs;
create trigger graphs_set_updated_at
  before update on public.graphs
  for each row execute function public.dsa_set_updated_at();

drop trigger if exists bible_characters_set_updated_at on public.bible_characters;
create trigger bible_characters_set_updated_at
  before update on public.bible_characters
  for each row execute function public.dsa_set_updated_at();

drop trigger if exists graph_nodes_set_updated_at on public.graph_nodes;
create trigger graph_nodes_set_updated_at
  before update on public.graph_nodes
  for each row execute function public.dsa_set_updated_at();

drop trigger if exists graph_edges_set_updated_at on public.graph_edges;
create trigger graph_edges_set_updated_at
  before update on public.graph_edges
  for each row execute function public.dsa_set_updated_at();

drop trigger if exists import_batches_set_updated_at on public.import_batches;
create trigger import_batches_set_updated_at
  before update on public.import_batches
  for each row execute function public.dsa_set_updated_at();

revoke all on function public.dsa_set_updated_at() from public, anon, authenticated;
