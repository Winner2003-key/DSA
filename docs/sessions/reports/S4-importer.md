# S4 report — book importer, graph validation CLI and the id salt

**Status: done.** 164 core tests and 61 script tests pass, both typechecks are clean, and the three
CLIs run. Nothing was committed. No database was available, so `--apply` was never run against
Supabase; everything below the network boundary is covered by tests with a fake store.

---

## 1. Files

### New workspace `scripts/` (`@dsa/scripts`, added to the root `workspaces`)

| File | Purpose |
|---|---|
| `scripts/package.json` | `@dsa/scripts`; deps `@dsa/core`, `@supabase/supabase-js`; devDeps `@types/node`, tsx, typescript, vitest |
| `scripts/tsconfig.json` | same strictness as core, plus `types: ["node"]` |
| `scripts/.env.example` | committed template (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DSA_ID_SALT`); `scripts/.env` is gitignored |
| `scripts/src/paths.ts` | repo layout (`data/book`, `scripts/.env`), `repoRelative` |
| `scripts/src/env.ts` | `.env` parser, `resolveEnv`, `loadEnv`, `EnvError` (refuses to run without the salt) |
| `scripts/src/book.ts` | reads `data/book`, builds the graph with the salt; graph slug, name and `source_document` constants |
| `scripts/src/select.ts` | spine detection, `--pages` scoping, dangling-edge detection, per-page stats |
| `scripts/src/rows.ts` | `GraphData` ↔ Supabase rows, the book-owned metadata key lists, admin-row detection |
| `scripts/src/diff.ts` | **pure**: `mergeNode/mergeEdge/mergeCharacter/mergeGraph`, `planImport`, `summarize`, `planByPage`, `projectSnapshot` |
| `scripts/src/batch.ts` | `chunk` (≤ 500) and `planWrites` (foreign-key order) |
| `scripts/src/store.ts` | the only Supabase code: `GraphStore` interface + `SupabaseGraphStore`, readable error messages |
| `scripts/src/args.ts` | flag parsing; unknown flags are refused |
| `scripts/src/format.ts` | French console output, the per-page lines and the tables |
| `scripts/src/import.ts` | `runImport`: build → validate → read → plan → print → (apply) |
| `scripts/validate-graph/index.ts` | `npm run book:validate` |
| `scripts/import-book/index.ts` | `npm run book:import` |
| `scripts/export-graph/index.ts` | `npm run book:export` (added to the root scripts) |
| `scripts/test/fixtures.ts` | **invented** transcription fixtures (ALPHA/BETA/GAMMA); no book content anywhere |
| `scripts/test/fake-store.ts` | in-memory `GraphStore` that records every write |
| `scripts/test/{diff,batch,env,args,select,import}.test.ts` | 61 tests |

### `IMPORT_GUIDE.md` (new, root)

Step by step for the owner: generate the salt once and keep it forever, where the service role key
is, `scripts/.env`, validate, dry run, apply, review and approve, publish, re-importing after
editing a `.dsa` file, what is preserved, backups with export, a flag reference and a
troubleshooting table.

### Additive changes in `packages/core`

| File | Change |
|---|---|
| `src/keys.ts` | `IdOptions {salt, allowUnsalted}`, `UNSALTED_GRAPH_SLUGS`, `isUnsaltedGraph`, `idPrefix`, `assertIdSalt`; `nodeId`, `edgeId`, `characterId` take the options |
| `src/book-parser.ts` | `buildGraphData(…, { idSalt, allowUnsalted })` threads them through; `assertIdSalt` runs first, so an empty book still throws |
| `src/validator.ts` | new error `DECISION_LABEL_UNKNOWN` |
| `src/types.ts` | `BuildOptions.idSalt/allowUnsalted`, `ValidationCode` gains `DECISION_LABEL_UNKNOWN` |
| `src/index.ts` | exports the new symbols and the `IdOptions` type |
| `test/salt.test.ts` | new: 5 tests |
| `test/validator.test.ts` | new `DECISION_LABEL_UNKNOWN` test; one existing expectation updated (see §4.1) |
| `test/{parser,real-book,basics}.test.ts` | pass `allowUnsalted: true` where they build a non-`mini` graph |

`graphId` is deliberately **not** salted: the slug is public and is how every lookup finds the graph.

---

## 2. Verification

### `npm test --workspace packages/core` — 164 passed (158 before, +6)

```
 Test Files  10 passed (10)
      Tests  164 passed (164)
```

### `npm run typecheck --workspace packages/core`

```
> tsc --noEmit            (exit 0, no output)
```

### `npm test --workspace scripts` — 61 passed

```
 ✓ test/batch.test.ts (6 tests)
 ✓ test/select.test.ts (6 tests)
 ✓ test/args.test.ts (7 tests)
 ✓ test/diff.test.ts (15 tests)
 ✓ test/env.test.ts (10 tests)
 ✓ test/import.test.ts (17 tests)

 Test Files  6 passed (6)
      Tests  61 passed (61)
```

### `npm run typecheck --workspace scripts`

```
> tsc --noEmit            (exit 0, no output)
```

### `npm run book:validate`

```
DSA — validation du livre (data/book)
Graphe : livre
Sel    : absent (identifiants NON salés, vérification locale seulement)

✓ 53 pages → 1647 nodes, 1646 edges, 1157 characters
✓ 0 build errors
✓ 0 build warnings

✓ 1647 nodes (START 1, QUESTION 14, CATEGORY 285, GROUP 138, CHARACTER 1209)
✓ 1646 edges
✓ 1157 characters
⚠ 0 playable characters
⚠ 1647 nodes and 1646 edges NEEDS_REVIEW
WARNING: [SHARED_CHARACTER_LABEL] … (110 warnings, all expected — DIGITIZATION_REPORT §7)
✓ valid (0 errors, 110 warnings)

Source              Nœuds  Arêtes  Personnages  NEEDS_REVIEW (nœuds+arêtes)
──────────────────  ─────  ──────  ───────────  ───────────────────────────
Colonne vertébrale     33      32            0                        33+32
Page 6                  4       4            0                          4+4
Page 8                 23      23           18                        23+23
…                                                                          
TOTAL                1647    1646         1157                    1647+1646

✓ Le livre est valide.
```

`npm run book:validate -- --approved` gives `✓ 1184 playable characters`, which matches S1.
Exit code 0; it would be 1 if there were any build or validation error.

### `npm run book:import -- --dry-run` without credentials

```
✗ Variables d'environnement manquantes : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSA_ID_SALT.
Renseignez-les dans scripts/.env (copiez scripts/.env.example) ou exportez-les dans le terminal :
  SUPABASE_URL= …   # Tableau de bord Supabase → Project Settings → API (Data API) → Project URL
  SUPABASE_SERVICE_ROLE_KEY= …   # Tableau de bord Supabase → Project Settings → API Keys → service_role (clé secrète)
  DSA_ID_SALT= …   # à générer UNE seule fois : node -e "console.log(crypto.randomUUID())", puis à conserver pour toujours
Voir IMPORT_GUIDE.md. Ce fichier est ignoré par git et ne doit jamais être partagé.
```

Exit code 1, and nothing was read or written.

### Dry run with a salt and a deliberately wrong URL (the whole pipeline except the database)

```
DSA — importation du livre
Graphe : livre — DSA — Découverte Sans Alphabet
Mode   : simulation (--dry-run, rien n’est écrit)
Pages  : tout le livre (53 pages)

✓ 53 pages → 1647 nodes, 1646 edges, 1157 characters
…
✓ valid (0 errors, 110 warnings)

✗ Erreur Supabase pendant la lecture de graphs : TypeError: fetch failed
Vérifiez SUPABASE_URL dans scripts/.env et votre connexion internet.
```

So: build, validation and the whole plan run with salted ids; only the network call fails, with the
message the owner needs. **`--apply` was never attempted** (no database, per the brief).

### What the tests prove instead of a real `--apply`

- a dry run performs **zero** writes of any kind (steps, `import_batches`, `graph_versions`);
- `--apply` writes in exactly the order `graphs → bible_characters → graph_nodes (character_id
  cleared) → graph_nodes (linked) → graph_edges`, batched at ≤ 500 rows;
- a second run against a database that already matches writes nothing and leaves the version alone;
- `review_status`, `review_note`, `position_x/y`, an edited `description`, edited `aliases`,
  `name_en/gender/testament` and unknown metadata keys survive an import;
- rows with `metadata.origin = 'admin'` are never updated and never pruned;
- prune candidates are found, are only deleted with `--prune`, and are limited to the selected pages;
- `--publish` is refused when nothing would be playable;
- the importer refuses an unknown page, and refuses a page whose parent node is nowhere to be found.

---

## 3. Console output (the format the brief asked for)

```
Page 23 — 47 nœuds (+47), 47 arêtes (+47), 34 personnages
```

`(+n)` inserted, `(~n)` updated, `(=)` nothing to do; both appear as `(+47, ~3)` when relevant.
The spine is printed as `Colonne vertébrale`. After the per-page lines come `Total`, `Inchangés`,
the preserved-admin-work summary, the prune warning and `Personnages jouables après import : N`.

---

## 4. Deviations and decisions

### 4.1 One existing core test expectation changed

`validator.test.ts` asserted that two distinct `AUTRE` decision labels produce **no** errors. Spec §7
now makes an APPROVED `AUTRE` decision edge an error, so that assertion contradicts the new rule. It
now asserts the narrower thing it was really about — that two different `AUTRE` labels are not a
`DUPLICATE_ANSWER_CLASS` — and a new test covers `DECISION_LABEL_UNKNOWN`. No other existing
expectation changed. The rule only fires on **APPROVED** edges, so a `{review}`-tagged unknown code
(the R6a case S1 reported) is still importable and reviewable. The real book has no `AUTRE` answer
label today, so the rule changes nothing for the book.

### 4.2 `allowUnsalted` had to be added to several existing core tests

`parseSpine`/`buildGraphData` tests use the slug `t`, and `real-book.test.ts` uses `livre`. They
now pass `allowUnsalted: true`. `basics.test.ts` does the same for its one `nodeId('livre', …)`
call. The mini fixture ids are unchanged and are asserted twice (in `basics` and in the new
`salt.test.ts`, with and without a salt).

### 4.3 A dry run writes nothing at all, including `import_batches`

The brief asks both for "write nothing" and for "one `import_batches` row per page … `VALIDATED`
(dry run)". I took "write nothing" as the stronger promise: by default a dry run touches nothing,
and the rows it *would* write are in the returned report and in `--json`. `--record-dry-run` opts
into writing them as `VALIDATED`. If you prefer the other reading, making `--record-dry-run` the
default is a one-line change.

### 4.4 The spine is identified structurally, not by page number

Spine lines carry `@pNN` too (`@p2`, `@p27`…), so a page number cannot tell a spine node from a page
node. The builder only makes `SYSTEM`/`DECISION` edges for spine lines and only `HIERARCHY` edges for
page lines, so the spine is exactly the closure from START over non-`HIERARCHY` edges. That is what
`--pages` uses to always include the spine.

### 4.5 Pruning is compared against the whole book, and scoped to the selected pages

Prune candidates are rows whose key is missing from the **entire** transcription, not just from the
selection — otherwise `--pages 23` would propose deleting the other 52 pages. They are then limited
to the selected pages, so a partial import can never touch the rest of the graph. Characters are
never pruned (`bible_characters` has no `graph_id`, and one row can be shared by several nodes).

### 4.6 Admin rows can only be recognised by `metadata.origin = 'admin'`

The brief says admin rows have "no `node_key`", but `graph_nodes.node_key` is `not null` in the
schema, so that can never happen. The importer accepts either (an empty key or the tag), and an edge
is treated as admin-owned if it carries the tag **or touches an admin node**. **S5 must set
`metadata.origin = 'admin'` on every row the admin creates**, otherwise a later `--prune` would
delete them. This is written into IMPORT_GUIDE §8.

### 4.7 Preserving an edited description and edited aliases needs a flag on the row

Following the brief's `metadata.description_edited`, character aliases use the same pattern
(`metadata.aliases_edited`). `name_en`, `gender`, `testament` and `is_active` are never written by
the book, so they are simply kept. S5 sets these flags when an admin edits those fields.

### 4.8 `--approve` approves rows that carry a `{review}` note, and says so

Read literally ("mark the imported rows of those pages APPROVED"). The note is preserved, and the
run prints `⚠ --approve a approuvé N ligne(s) portant une note « à revoir »` with the keys, so
nothing is approved silently.

### 4.9 Extras not in the brief

- `--publish` is also refused when **no character would be playable**, computed by projecting the
  plan onto the current rows. Publishing with nothing approved would give `DSA_NO_PLAYABLE_SECRET`
  on every game.
- `npm run book:export` was added to the root scripts (the brief named the file but no script).
- `--json` also exists on the importer, `--pages` accepts ranges (`8-12`), and `--batch-size` exists
  for tests. Unknown flags are errors: `--aply` must not silently become a dry run.
- The graph row's `version`, `is_active` and `description` are preserved; `status` only ever moves
  to `PUBLISHED`, and only with `--publish`. The importer never un-publishes.
- `graph_versions.snapshot` holds the import summary (counts per page, playable count), not a full
  copy of the graph; `notes` is a one-line French description of the run.

### 4.10 Language

The CLIs speak French (the brief's own example line is French, and the owner reads them); the blocks
produced by `@dsa/core` (`formatBuildReport`, `formatReport`) are printed as they come, in English.
Code, comments, `IMPORT_GUIDE.md` and this report are in English.

### 4.11 `@types/node`

`scripts/` needs real Node typings (`fs`, `process`, `path`), so `@types/node` is a devDependency of
that workspace. `packages/core` keeps its shim and its purity test: nothing in `core/src` gained a
Node dependency.

---

## 5. Notes for the other sessions

**S5 (admin)**

- Set `metadata.origin = 'admin'` on every node and edge the admin creates (§4.6).
- Set `metadata.description_edited = true` when an admin edits a node or character description, and
  `metadata.aliases_edited = true` for aliases (§4.7), otherwise the next import overwrites them.
- Everything else an admin touches — `review_status`, `review_note`, `position_x/y` — is already
  preserved with no marker.
- `import_batches` gets one row per page per run: `stats` holds the page counts, `report` holds the
  options, the totals, the prune candidates and the preserved fields. `source` is the `.dsa` file
  name, which is a safe label to show.
- `scripts/src/rows.ts` has the row ↔ `GraphData` mapping if the admin wants the same shapes.

**S3 (mobile)** — nothing to do; ids are opaque either way.

---

## 6. Open questions

1. **Salted ids do not fix the whole leak S2 raised.** The salt stops a player from computing a
   leaf's id from its name, which is the offline attack. A player who can watch ids across several
   games can still tell two prompts apart, and `path[].node_id` is still a stable identifier. If the
   lead wants the full fix, it is S2's suggestion (a per-session opaque prompt id) and it changes the
   state JSON. Worth deciding before S6/S8.
2. **Where should the salt live for the admin app?** The admin never computes ids (it reads them), so
   it does not need the salt today. If S5 ever wants to create a node *at a book key*, it would need
   it, and a service-role secret in a Next.js server action is a different security discussion.
3. **`--record-dry-run` or not** (§4.3): the lead should confirm which reading of the brief wins.
4. **Character pruning** is not implemented (§4.5). If a character row is ever orphaned — every node
   that pointed at it was pruned — it stays in `bible_characters`. Should the importer offer a
   `--prune-characters`, or should the admin clean them up?
5. **`{review}` subtrees.** The two subtrees the transcription tagged `{review}` (S1 report, open
   question 4) keep 25 characters unplayable. The owner has to decide on them in the admin; the importer just carries the
   tag through.
6. **No hosted run yet.** The first real `--apply` is the owner's. The lines to check are the per-page
   lines, then a second `--dry-run` reporting everything as `(=)`, which is the idempotency proof.
