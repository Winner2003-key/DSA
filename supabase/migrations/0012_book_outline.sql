-- =============================================================================
-- DSA — Découverte Sans Alphabet
-- 0012_book_outline.sql — the picker shows the book's outline, not the graph's
--                         shape (GRAPH_SPECIFICATION.md §2 "scope")
--
-- Re-runnable. Requires 0010 (and therefore everything before it).
--
--   1. dsa_graph_tree       + answer_label: the answer that leads into a node
--   2. dsa_sections         + node_type, answer_label
--      dsa_list_sections    + node_type, answer_label (the picker's rows)
--   3. privileges
--
-- Nothing about the game changes: a scope still restricts only which name is
-- drawn, and the questions still start at the beginning. What changes is what
-- the picker can say. Until now it could only show the graph as it is — the
-- question « ANCIEN » with two children both called « HOMME », one for each
-- testament — because the rows carried no answer. With the answer and the node
-- type, the app folds the same rows into the outline the book prints:
--
--   ANCIEN > HOMME > PENTATEUQUE, LES 3 PREMIERS, LIVRE DE SAMUEL, …
--   ANCIEN > FEMME > PENTATEUQUE, LIVRES HISTORIQUES, LIVRES PROPHETIQUES
--   NOUVEAU > …
--
-- The rule lives in packages/core/src/outline.ts (`bookOutline`); this file only
-- hands over the two facts it needs. Still no name, no clue and no leaf: the
-- picker says no more than a table of contents.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Prerequisite: the rules-and-practice update (0010 / 07_rules_scope.sql)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dsa_list_sections(text)') is null then
    raise exception 'DSA SETUP: this project predates the rules-and-practice update; run 07_rules_scope.sql first, then this file again';
  end if;
end;
$$;


-- #############################################################################
-- 1. dsa_graph_tree: the answer that reached each node
-- #############################################################################
-- The walk already follows the edges, so it only has to carry the answer label
-- of the edge it came through (null at START). The return type changes, so the
-- function is dropped first; nothing depends on it by name.
drop function if exists public.dsa_graph_tree(uuid);

create or replace function public.dsa_graph_tree(p_graph_id uuid)
returns table (
  node_id      uuid,
  node_type    text,
  label        text,
  parent_id    uuid,
  depth        integer,
  ancestors    uuid[],
  order_path   integer[],
  answer_label text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with recursive tree (node_id, node_type, label, parent_id, depth, ancestors, order_path, answer_label) as (
    select n.id, n.node_type, n.label, null::uuid, 0, '{}'::uuid[], '{}'::integer[], null::text
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
      t.order_path || e.order_index,
      e.answer_label
    from tree t
    join public.graph_edges e on e.from_node_id = t.node_id
    join public.graph_nodes c on c.id = e.to_node_id
    where e.review_status = 'APPROVED'
      and c.review_status = 'APPROVED'
      and not (c.id = any (t.ancestors || t.node_id))
  )
  select t.node_id, t.node_type, t.label, t.parent_id, t.depth, t.ancestors, t.order_path, t.answer_label
  from tree t;
$$;


-- #############################################################################
-- 2. The sections, with what the picker needs to read them
-- #############################################################################
drop function if exists public.dsa_sections(uuid);

create or replace function public.dsa_sections(p_graph_id uuid)
returns table (
  node_id      uuid,
  label        text,
  parent_id    uuid,
  depth        integer,
  characters   integer,
  node_type    text,
  answer_label text
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
  select t.node_id, t.label, t.parent_id, t.depth, coalesce(c.characters, 0), t.node_type, t.answer_label
  from tree t
  left join counts c on c.node_id = t.node_id
  where t.node_type <> 'CHARACTER'
  order by t.order_path;
$$;

-- dsa_list_sections -> the picker's rows. Players only.
-- Labels, parents, depths, counts, and now the node type and the answer that
-- leads in — and **never** a name, a clue or a leaf.
drop function if exists public.dsa_list_sections(text);

create or replace function public.dsa_list_sections(p_graph_slug text)
returns table (
  node_id      uuid,
  label        text,
  parent_id    uuid,
  depth        integer,
  characters   integer,
  node_type    text,
  answer_label text
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
    select s.node_id, s.label, s.parent_id, s.depth, s.characters, s.node_type, s.answer_label
    from public.dsa_sections(v_graph_id) s;
end;
$$;


-- #############################################################################
-- 3. Privileges (the drops above took them with them)
-- #############################################################################
revoke all on function public.dsa_graph_tree(uuid) from public, anon, authenticated;
revoke all on function public.dsa_sections(uuid) from public, anon, authenticated;

revoke all on function public.dsa_list_sections(text) from public, anon;
grant execute on function public.dsa_list_sections(text) to authenticated;
