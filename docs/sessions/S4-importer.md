# Brief S4 — Book importer, graph validation CLI and the id salt

You are a senior TypeScript / data engineer on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game. Repo: `/home/winner/projects/DSA` (npm workspaces; Node 22).

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no git commit, stay in your folders)
2. `GRAPH_SPECIFICATION.md`, especially §2 (keys and ids), §5 (transcription format) and **§7 (wave-1 decisions: salted ids, AUTRE rule)**
3. `DATABASE_SCHEMA.md`: the tables, constraints and `import_batches`
4. `docs/sessions/reports/S1-core.md` and `S2-database.md`
5. `packages/core/src/{keys,book-parser,validator}.ts` and `packages/core/scripts/load-book.ts`

`data/book/` is **gitignored on purpose** (the transcription stays private). It exists locally. Never copy its content into tracked files or test snapshots.

## You own
- `scripts/**`, including a workspace package `scripts/package.json` named `@dsa/scripts` (add `"scripts"` to the root workspaces array);
- `IMPORT_GUIDE.md`;
- **limited, additive changes** in `packages/core`:
  - `keys.ts`: optional salt;
  - `book-parser.ts`: pass the salt through `buildGraphData` options;
  - `validator.ts`: the AUTRE rule;
  - their tests.

  Every existing core test must still pass, and the mini fixture ids must stay unchanged (mini is never salted).

Run `npm install` for your workspace. Another two sessions install at the same time: on a lock or ENOTEMPTY error, wait 30 s and retry, and never delete `package-lock.json`.

## Deliver
1. **Salted ids (core).**
   - `nodeId`, `edgeId` and `characterId` take an optional `salt`, giving `graphSlug + ':' + salt + ':' + key`.
   - `buildGraphData(…, { idSalt })`.
   - Throw if the graph slug isn't `mini` and no salt is given, unless `allowUnsalted: true` (tests only).
   - Tests: the mini ids are unchanged, salted ids differ, and the result is deterministic.
2. **Validator:** an APPROVED `DECISION` edge whose `answerClass` is `AUTRE` is an error (`DECISION_LABEL_UNKNOWN`). Add a test.
3. **`scripts/validate-graph/index.ts`** (`npm run book:validate` at the root):
   - loads `data/book`, builds `livre` (salt from env if present, otherwise `allowUnsalted` for a local check);
   - prints `formatBuildReport` plus `formatReport`, and a per-page table (nodes, edges, characters, NEEDS_REVIEW);
   - exits with code 1 on errors.
   - Flags: `--approved` (simulate everything approved, to see the playable count), `--json out.json`.
4. **`scripts/import-book/index.ts`** (`npm run book:import`):
   - **Env** (`scripts/.env`, gitignored; commit `scripts/.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DSA_ID_SALT`. Refuse to run without the salt.
   - **Flags:**
     - `--graph livre`, `--name "DSA — Découverte Sans Alphabet"`;
     - `--dry-run` (default: print exactly what would be inserted, updated or unchanged; write nothing);
     - `--apply`;
     - `--pages 8,9,23` (limit to pages; spine always included);
     - `--approve` (mark the imported rows of those pages APPROVED; otherwise new rows are NEEDS_REVIEW or come from `{review}` tags);
     - `--publish` (set graph status PUBLISHED; refuse if validation has errors);
     - `--prune` (delete DB nodes and edges with book keys that no longer exist in the transcription; without it they're only reported).
   - **Idempotent upsert** in batches (≤500 rows), in FK order: graph → characters → nodes (without `character_id`) → set `character_id` → edges.
   - **Never overwrite admin work.** On existing rows, update only book-owned fields (label, question, node_type, source_page, metadata book fields, order_index, edge label/kind). **Keep** `review_status` (unless `--approve`), `review_note`, `position_x/y`, `description` if edited (track `metadata.description_edited`), and admin-created rows (no `node_key`, or `metadata.origin = 'admin'`).
   - Write one `import_batches` row per page with the report JSON (counts, warnings, diff summary) and status `VALIDATED` (dry run) or `APPLIED`.
   - Validate before applying; abort on build or validation errors.
   - Clear console output: `Page 23 — 61 nœuds (+61), 60 arêtes (+60), 48 personnages`.
   - Set `graphs.source_document = 'Livre source (hors dépôt)'`, and bump `graph_versions` with a description when anything changed.
5. **`scripts/export-graph/index.ts`**: DB → `GraphData` JSON file (admin backup; `--out`). The same env.
6. **Tests** (vitest in `@dsa/scripts`):
   - the diff and merge logic as pure functions (new, changed, unchanged, preserved admin fields, prune candidates) against small GraphData fixtures;
   - batch ordering;
   - the refusal without a salt;
   - a dry run producing no writes (mocked Supabase client).
   
   Don't put real book content in fixtures.
7. **`IMPORT_GUIDE.md`**, for the owner, step by step:
   - generate a salt once (`node -e "console.log(crypto.randomUUID())"`) and **keep it forever** (changing it changes every id);
   - where to find the service role key; fill in `scripts/.env`;
   - `npm run book:validate`;
   - `npm run book:import -- --dry-run`, then `--apply`;
   - review and approve (in the admin UI from S5, or `--pages … --approve` for pages already checked);
   - `--publish`; re-importing after editing a `.dsa` file; what is preserved; backing up with export;
   - troubleshooting.

## Verification (paste the output in the report)
- `npm test --workspace packages/core` (all green, same count plus your additions)
- `npm test --workspace scripts`
- typecheck for both
- `npm run book:validate` (the real summary lines; no book content beyond counts)
- `npm run book:import -- --dry-run` **without** credentials must fail with a clear message. You have no database, so don't attempt `--apply`.

## Report
Write `docs/sessions/reports/S4-importer.md` with the files, outputs, deviations and open questions.
