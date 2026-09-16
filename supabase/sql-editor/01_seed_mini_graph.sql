-- =============================================================================
-- DSA — 01_seed_mini_graph.sql
-- The mini graph from docs/sessions/mini-graph-fixture.md, exactly.
-- Used by 90_tests.sql and by the apps for development.
--
-- Run after 00_all_migrations.sql. Idempotent: rows are upserted on id.
-- IDs are UUID v5 with namespace 6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a:
--   graph      'mini'                      (graph id; not fixed by the fixture)
--   node       'mini:<node_key>'
--   edge       'mini:<from_key>-><to_key>'
--   character  'mini:character:<node_key>' (first node of that character;
--                                           not fixed by the fixture)
-- =============================================================================

create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;

begin;

-- -----------------------------------------------------------------------------
-- Graph
-- -----------------------------------------------------------------------------
insert into public.graphs (id, slug, name, description, version, is_active, status, source_document)
values (
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini'),
  'mini',
  'DSA mini',
  null,
  1, true, 'PUBLISHED', null
)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  version = excluded.version,
  is_active = excluded.is_active,
  status = excluded.status,
  source_document = excluded.source_document;

-- -----------------------------------------------------------------------------
-- Characters (ABRAHAM and ABRAM share one row)
-- description = "<clue> · <nearest CATEGORY label>"
-- -----------------------------------------------------------------------------
insert into public.bible_characters (id, name, description, aliases, is_active)
select
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini:character:' || v.node_key),
  v.name, v.description, v.aliases, true
from (values
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/premier-homme--adam',
     'ADAM', 'Premier homme · LIE A ADAM', '{}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain',
     'CAÏN', 'Le meurtrier · LIE A ADAM', '{}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/plus-connu--abraham',
     'ABRAHAM', 'PÈRE DE LA FOI · LIE A ABRAHAM', '{ABRAM}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-d-agar--ismael',
     'ISMAËL', 'FILS D''AGAR · LIE A ABRAHAM', '{}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-de-la-promesse--isaac',
     'ISAAC', 'FILS DE LA PROMESSE · LIE A ABRAHAM', '{}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue',
     'JOSUE', 'Serviteur de MOÏSE · LES 3 PREMIERS', '{}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david',
     'DAVID', 'fils d''isaï · LIE A DAVID', '{}'::text[]),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois/le-premier--jeroboam',
     'JEROBOAM', 'LE PREMIER · LES ROIS', '{}'::text[]),
  ('ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers/verse-dans-les-ecritures--esdras',
     'ESDRAS', 'VERSÉ DANS LES ÉCRITURES · LES 3 DERNIERS', '{}'::text[]),
  ('ancien[non]/homme[oui]/les-evangiles/le-sauveur--jesus-christ',
     'JESUS-CHRIST', 'le sauveur · LES EVANGILES', '{}'::text[]),
  ('ancien[non]/homme[oui]/les-evangiles/fils-d-alphee--jacques',
     'JACQUES', 'Fils d''Alphée · LES EVANGILES', '{}'::text[]),
  ('ancien[non]/homme[oui]/les-evangiles/fils-de-zebedee--jacques',
     'JACQUES', 'Fils de Zébédée · LES EVANGILES', '{}'::text[])
) as v (node_key, name, description, aliases)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  aliases = excluded.aliases,
  is_active = excluded.is_active;

-- -----------------------------------------------------------------------------
-- Nodes (book order under each parent)
-- character_key = node_key of the character row (ABRAM points to ABRAHAM's)
-- -----------------------------------------------------------------------------
insert into public.graph_nodes (
  id, graph_id, node_key, node_type, label, question, character_id, review_status, metadata
)
select
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini:' || v.node_key),
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini'),
  v.node_key,
  v.node_type,
  v.label,
  v.question,
  case when v.character_key is null then null
       else extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini:character:' || v.character_key)
  end,
  'APPROVED',
  v.metadata::jsonb
from (values
  ('dsa', 'START', 'DSA', null, null, '{}'),
  ('ancien', 'QUESTION', 'ANCIEN', null, null, '{}'),
  ('ancien[oui]/homme', 'QUESTION', 'HOMME', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque', 'QUESTION', 'PENTATEUQUE', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes', 'CATEGORY', 'PENTATEUQUE (HOMMES)', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam', 'CATEGORY', 'LIE A ADAM', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1', 'GROUP', 'CLASSE 1', null, null,
     '{"group_kind": "CLASSE"}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/premier-homme--adam', 'CHARACTER', 'ADAM', 'Premier homme',
     'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/premier-homme--adam', '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain', 'CHARACTER', 'CAÏN', 'Le meurtrier',
     'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain', '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham', 'CATEGORY', 'LIE A ABRAHAM', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi', 'GROUP', 'PÈRE DE LA FOI', null, null,
     '{"group_kind": "ALIAS"}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/plus-connu--abraham', 'CHARACTER', 'ABRAHAM', 'plus connu',
     'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/plus-connu--abraham', '{"qualifier": "plus connu"}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/moin-connu--abram', 'CHARACTER', 'ABRAM', 'moin connu',
     'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/plus-connu--abraham', '{"qualifier": "moin connu"}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1', 'GROUP', 'TOME 1', null, null,
     '{"group_kind": "TOME"}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-d-agar--ismael', 'CHARACTER', 'ISMAËL', 'FILS D''AGAR',
     'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-d-agar--ismael', '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-de-la-promesse--isaac', 'CHARACTER', 'ISAAC', 'FILS DE LA PROMESSE',
     'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-de-la-promesse--isaac', '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers', 'CATEGORY', 'LES 3 PREMIERS', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue', 'CHARACTER', 'JOSUE', 'Serviteur de MOÏSE',
     'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue', '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel', 'QUESTION', 'LIVRE DE SAMUEL', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david', 'CATEGORY', 'LIE A DAVID', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david', 'CHARACTER', 'DAVID', 'fils d''isaï',
     'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david', '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois', 'CATEGORY', 'LES ROIS', null, null, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois/le-premier--jeroboam', 'CHARACTER', 'JEROBOAM', 'LE PREMIER',
     'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois/le-premier--jeroboam', '{}'),
  ('ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers', 'CATEGORY', 'LES 3 DERNIERS', null, null, '{}'),
  ('ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers/verse-dans-les-ecritures--esdras', 'CHARACTER', 'ESDRAS', 'VERSÉ DANS LES ÉCRITURES',
     'ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers/verse-dans-les-ecritures--esdras', '{}'),
  ('ancien[non]/homme', 'QUESTION', 'HOMME', null, null, '{}'),
  ('ancien[non]/homme[oui]/les-evangiles', 'CATEGORY', 'LES EVANGILES', null, null, '{}'),
  ('ancien[non]/homme[oui]/les-evangiles/le-sauveur--jesus-christ', 'CHARACTER', 'JESUS-CHRIST', 'le sauveur',
     'ancien[non]/homme[oui]/les-evangiles/le-sauveur--jesus-christ', '{}'),
  ('ancien[non]/homme[oui]/les-evangiles/fils-d-alphee--jacques', 'CHARACTER', 'JACQUES', 'Fils d''Alphée',
     'ancien[non]/homme[oui]/les-evangiles/fils-d-alphee--jacques', '{}'),
  ('ancien[non]/homme[oui]/les-evangiles/fils-de-zebedee--jacques', 'CHARACTER', 'JACQUES', 'Fils de Zébédée',
     'ancien[non]/homme[oui]/les-evangiles/fils-de-zebedee--jacques', '{}')
) as v (node_key, node_type, label, question, character_key, metadata)
on conflict (id) do update set
  graph_id = excluded.graph_id,
  node_key = excluded.node_key,
  node_type = excluded.node_type,
  label = excluded.label,
  question = excluded.question,
  character_id = excluded.character_id,
  review_status = excluded.review_status,
  metadata = excluded.metadata;

-- CHARACTER nodes carry their character's description (same as packages/core).
update public.graph_nodes n
set description = c.description
from public.bible_characters c
where c.id = n.character_id
  and n.graph_id = extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini')
  and n.description is distinct from c.description;

-- -----------------------------------------------------------------------------
-- Edges. order_index = book order among the edges leaving the same node.
-- -----------------------------------------------------------------------------
insert into public.graph_edges (
  id, graph_id, from_node_id, to_node_id, answer_label, edge_kind, order_index, review_status, metadata
)
select
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini:' || v.from_key || '->' || v.to_key),
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini'),
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini:' || v.from_key),
  extensions.uuid_generate_v5('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a', 'mini:' || v.to_key),
  v.answer_label,
  v.edge_kind,
  v.order_index,
  'APPROVED',
  v.metadata::jsonb
from (values
  -- SYSTEM / DECISION (spine)
  ('dsa', 'ancien', 'SYSTEM', 'DÉBUT', 0, '{}'),
  ('ancien', 'ancien[oui]/homme', 'DECISION', 'OUI', 0, '{}'),
  ('ancien', 'ancien[non]/homme', 'DECISION', 'NON', 1, '{}'),
  ('ancien[oui]/homme', 'ancien[oui]/homme[oui]/pentateuque', 'DECISION', 'OUI', 0, '{}'),
  ('ancien[oui]/homme', 'ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers', 'DECISION', 'JE NE SAIS PAS', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes', 'DECISION', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque', 'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers', 'DECISION', 'NON', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque', 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel', 'DECISION', 'NONONONON', 2,
     '{"source_variants": [{"label": "NONONONO", "page": 27}]}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel', 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david', 'DECISION', 'OUIOUIOUI', 0,
     '{"source_variants": [{"label": "OUIOUIOUIOUI", "page": 32}]}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel', 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois', 'DECISION', 'NON', 1, '{}'),
  ('ancien[non]/homme', 'ancien[non]/homme[oui]/les-evangiles', 'DECISION', 'OUI', 0, '{}'),

  -- HIERARCHY (label OUI, book order)
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham', 'HIERARCHY', 'OUI', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/premier-homme--adam', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain', 'HIERARCHY', 'OUI', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1', 'HIERARCHY', 'OUI', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/plus-connu--abraham', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/pere-de-la-foi/moin-connu--abram', 'HIERARCHY', 'OUI', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-d-agar--ismael', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-abraham/tome-1/fils-de-la-promesse--isaac', 'HIERARCHY', 'OUI', 1, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers', 'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david', 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois', 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[non]/les-rois/le-premier--jeroboam', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers', 'ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers/verse-dans-les-ecritures--esdras', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[non]/homme[oui]/les-evangiles', 'ancien[non]/homme[oui]/les-evangiles/le-sauveur--jesus-christ', 'HIERARCHY', 'OUI', 0, '{}'),
  ('ancien[non]/homme[oui]/les-evangiles', 'ancien[non]/homme[oui]/les-evangiles/fils-d-alphee--jacques', 'HIERARCHY', 'OUI', 1, '{}'),
  ('ancien[non]/homme[oui]/les-evangiles', 'ancien[non]/homme[oui]/les-evangiles/fils-de-zebedee--jacques', 'HIERARCHY', 'OUI', 2, '{}')
) as v (from_key, to_key, edge_kind, answer_label, order_index, metadata)
on conflict (id) do update set
  graph_id = excluded.graph_id,
  from_node_id = excluded.from_node_id,
  to_node_id = excluded.to_node_id,
  answer_label = excluded.answer_label,
  edge_kind = excluded.edge_kind,
  order_index = excluded.order_index,
  review_status = excluded.review_status,
  metadata = excluded.metadata;

commit;

select
  (select count(*) from public.graph_nodes n join public.graphs g on g.id = n.graph_id where g.slug = 'mini') as mini_nodes,       -- expect 30
  (select count(*) from public.graph_edges e join public.graphs g on g.id = e.graph_id where g.slug = 'mini') as mini_edges,       -- expect 29
  (select count(*) from public.bible_characters c
     where c.id in (select n.character_id from public.graph_nodes n join public.graphs g on g.id = n.graph_id where g.slug = 'mini')
  ) as mini_characters;                                                                                                             -- expect 12
