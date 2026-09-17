# Report S5: `apps/admin` (graph editor and import review)

Status: **done.** Typecheck is clean, 44 tests pass and the production build succeeds. Every screen was driven in a headless browser with the mock repository: no console errors, no page errors, no server errors. Nothing was committed.

**Not verified: running against a real Supabase project.** No database was available. Everything that talks to Supabase goes through `src/lib/graph-repository.ts`. The owner's first sign-in and first save are the real test (see §4).

## 1. Result lines

```
$ npm run typecheck --workspace apps/admin
> tsc --noEmit
exit 0

$ npm test --workspace apps/admin
 ✓ test/access.test.ts (5 tests)
 ✓ test/rows.test.ts (4 tests)
 ✓ test/diff.test.ts (7 tests)
 ✓ test/layout.test.ts (6 tests)
 ✓ test/publish.test.ts (2 tests)
 ✓ test/review-search.test.ts (7 tests)
 ✓ test/editor-store.test.ts (13 tests)
 Test Files  7 passed (7)
      Tests  44 passed (44)

$ npm run build --workspace apps/admin
 ▲ Next.js 15.5.25
 ✓ Compiled successfully
Route (app)                                 Size  First Load JS
┌ ○ /                                      122 B         103 kB
├ ƒ /connexion                           1.07 kB         175 kB
├ ƒ /graphes                             1.36 kB         107 kB
├ ƒ /graphes/[slug]                      94.5 kB         268 kB
├ ƒ /graphes/[slug]/revue                4.76 kB         111 kB
└ ○ /icon.svg
ƒ Middleware                             93.8 kB
exit 0
```

The brief's required tests, and where they live:

| Required | File | What it checks |
|---|---|---|
| row ⇄ GraphData round-trip | `rows.test.ts` | The whole mini graph round-trips with `toEqual`. Column names match DATABASE_SCHEMA.md. `source_variants` survives. Unknown enum values and null metadata are narrowed. |
| diff | `diff.test.ts` | Add, update (changed field names), delete, reorder (sibling swap counted as reordered), and a position-only change counted as "déplacé" rather than "modifié". Metadata key order doesn't produce a false edit. Created characters. |
| undo/redo store | `editor-store.test.ts` | Undo/redo; merged keystrokes; a whole drag as one step; redo cleared by a new edit; no-ops; history cap; undoing a subtree deletion; admin-created rows (v4 id, `metadata.origin = 'admin'`, appended at the end); edge kind from the source node type; reorder and renumbering; `~2` key collisions; `clearPositions`. |
| tree layout follows `order_index` | `layout.test.ts` | Edges fed out of order still lay out left to right by `order_index`; ties broken by `id`; one row per level; parent centred; cycles; saved position wins; dagre ordering. |
| admin gate redirects non-admins (mocked) | `access.test.ts` | A stubbed Supabase client. Signed out → redirect to `/connexion?suite=…` without calling the RPC. Signed in but not admin → `FORBIDDEN` (no redirect: they see "Accès réservé aux administrateurs"). RPC error → `FORBIDDEN`. `'true'` as a string → `FORBIDDEN`. Admin → `APP`. |
| extra | `publish.test.ts`, `review-search.test.ts` | Publishing is refused with the `validateGraph` errors; per-page review counts, newest batch per page, page tree in book order; accent-insensitive search; delete impact. |

**Mutation check.** I broke two rules on purpose and the tests failed, then restored them. Sorting siblings without `order_index` failed two layout tests. Accepting any non-error `dsa_is_admin` reply failed two gate tests.

### Scale, on the real book (1,647 nodes)

The real graph was built in memory from `data/book` with a scratch script that printed timings only, then deleted. No book content was written anywhere.

```
graph: 1647 nodes, 1646 edges, 1157 characters
layoutTree (whole graph)                 4.2 ms
layoutDagre (whole graph)              911.5 ms   (only when "Couches (dagre)" is chosen)
validateGraph                            7.5 ms
computeDiff (whole graph)               10.4 ms   (runs on every edit, for the save counter)
100 store edits                          3–5 ms
buildPageReviews (65 pages)              4.0 ms
searchNodes "ab"                        28.3 ms
```

**Not measured:** React Flow rendering all 1,647 cards in the browser. Mock mode only serves the 30-node fixture, and the book can't be sent to a browser page from a tracked file. "Graphe entier" turns on `onlyRenderVisibleElements` above 200 cards. Focus mode (the default) shows about 10 cards at depth 3.

## 2. Screenshots (`docs/sessions/reports/S5-screens/`)

`next dev` ran with `NEXT_PUBLIC_DSA_MOCK=1`, driven by Playwright with the system Chrome at 1440×900 (tablet shots at 1024×768).

| File | Shows |
|---|---|
| `01-graphes.png` | Graphs list |
| `02-editeur-focus.png` | Editor, focus mode from START, depth 3 |
| `03-editeur-noeud-selectionne.png` | Opened from the review's "Modifier" on a NEEDS_REVIEW character (dashed amber), with the side panel |
| `04-recherche.png`, `04b-saut-vers-resultat.png` | Search, then jumping to a result |
| `05-graphe-entier-validation.png` | Whole graph, **Valider** panel |
| `06-enregistrer.png` | Save dialog with its French summary |
| `07-apercu-partie.png` | **Aperçu de partie** played to 🎉 ADAM |
| `08-revue.png`, `09-revue-page-34.png`, `10-revue-rejet.png` | Review table, a page opened, rejecting with a note |
| `11-tablette-editeur.png`, `12-tablette-revue.png` | 1024×768 |
| `13-publication.png`, `14-revue-apres-actions.png` | Publishing; the review after approving one page, rejecting one and bulk-approving two |

What the script checked along the way:
- the save counter goes `Enregistrer (1)` → Ctrl+Z → `Enregistrer` → Ctrl+Shift+Z → `Enregistrer (1)`;
- saving shows `Enregistré : 1 nœud modifié.`;
- publish, then unpublish;
- `Page 34 approuvée (2 lignes).`, `Page 41 rejetée (2 lignes).` with its note, and `Pages 41, 53 approuvées (4 lignes).` after the confirmation;
- "Modifier" opens the editor with the page root selected.

## 3. Files

Everything is under `apps/admin/`. Outside it, only the root `package-lock.json` changed (`npm install` for the workspace), plus this report and its screenshots.

```
package.json            @dsa/admin: next 15.5, react 19, @xyflow/react 12, @supabase/ssr + supabase-js, @dagrejs/dagre, zustand 5; dev: tailwindcss 4, vitest
next.config.ts          transpilePackages ['@dsa/core'] (core ships raw TS), devIndicators off
tsconfig.json           strict, noUnusedLocals, noImplicitOverride
vitest.config.ts, postcss.config.mjs, next-env.d.ts
.env.example            NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (+ commented dev-only NEXT_PUBLIC_DSA_MOCK)

src/middleware.ts                      session refresh; signed-out → /connexion?suite=…
src/lib/env.ts                         the two public vars; MOCK_MODE (never true in a production build)
src/lib/supabase/{client,server,middleware}.ts   @supabase/ssr clients
src/lib/access.ts                      resolveAccess (getUser + rpc dsa_is_admin) and gateOutcome: pure, tested
src/lib/admin-guard.ts                 assertAdmin() for server actions (server-only)
src/lib/rows.ts                        snake_case rows ⇄ @dsa/core types
src/lib/graph-repository.ts            the only Supabase data access: listGraphs, loadGraph (paged), saveDiff, setGraphStatus, reviewPages, listImportBatches
src/lib/mock-repository.ts             dev-only in-memory repository over packages/core/fixtures/mini-graph.json
src/lib/repository-{browser,server}.ts pick mock or Supabase
src/lib/diff.ts                        computeDiff, summarize, describeDiff (French)
src/lib/tree.ts                        book-order children, ancestors, subtrees, delete impact, edge kind for a source node
src/lib/layout.ts                      layoutTree (tidy, order_index), layoutDagre, resolvePosition
src/lib/search.ts                      nodes (label, clue, description, key) and characters (name, alias, description)
src/lib/review.ts                      per-page counts, page roots, page tree
src/lib/publish.ts                     checkPublishable (validateGraph)
src/lib/labels.ts                      French labels for the enums

src/store/editor-store.ts              zustand: baseline, working copy, undo/redo history, selection, every edit command

src/app/layout.tsx, globals.css, icon.svg, page.tsx (→ /graphes)
src/app/connexion/page.tsx             email + password sign-in
src/app/graphes/layout.tsx             the admin gate for every /graphes route; "Accès réservé aux administrateurs"
src/app/graphes/page.tsx, actions.ts   graphs list; publish / unpublish server actions
src/app/graphes/[slug]/page.tsx        editor (?noeud=<id> opens focused on a node)
src/app/graphes/[slug]/revue/page.tsx, actions.ts   import review; approvePages / rejectPage server actions

src/components/ui.tsx, sign-in-form.tsx, sign-out-button.tsx, publish-controls.tsx
src/components/editor/graph-editor.tsx       canvas, command bar, focus bar, search, tabs, shortcuts, unsaved-changes guard, JSON export
src/components/editor/node-card.tsx, answer-edge.tsx         React Flow node and edge
src/components/editor/node-inspector.tsx, edge-inspector.tsx, fields.tsx
src/components/editor/validation-panel.tsx, preview-panel.tsx, save-dialog.tsx
src/components/review/review-board.tsx

test/*.test.ts, test/helpers.ts
```

### Design

The direction is a proofreading desk, set up for hours of comparing a transcribed page with the printed book.
- **Colour.** The interface stays grey, and colour is used only for review status: amber = to review, red = rejected, green = approved, slate = draft. One teal accent marks selection and main actions. If something is coloured, that's where the work is.
- **Fonts.** The tool speaks in a grotesque (Archivo). **Every string that comes from the book** (questions, clues, names, keys) is set in a serif (Newsreader), so transcribed text never reads as UI.
- **Cards.** The node card is the one expressive element:
  - a left strip in the review colour;
  - the answer that leads to the card printed above its label;
  - CHARACTER cards show the clue in italic above the NAME;
  - the page number sits bottom-right, like a page number in a book;
  - NEEDS_REVIEW cards have a dashed amber border, REJECTED cards a red one.
- **Layout.** Desktop first; checked at 1024×768.

## 4. Owner steps

1. **Supabase:** follow DATABASE_SCHEMA.md "Setup in the Supabase dashboard" if not done yet (`00`, `01`, `90`).
2. **Create the admin account:** in the dashboard, **Authentication → Users → Add user → Create new user**, with your email and a password. Tick *Auto Confirm User*, otherwise you have to confirm by email first.
3. **Make it admin:** open `supabase/sql-editor/02_make_admin.sql`, replace `REPLACE_WITH_YOUR_EMAIL`, paste it into the SQL Editor and click **Run**. Expect one row with your user id.
4. **Local env:** `cp apps/admin/.env.example apps/admin/.env.local`, then fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → Data API / API Keys). **Never the service role key.**
5. **Run:** `npm install` at the repo root, then `npm run admin`, and open <http://localhost:3000>. Sign in; you should see the graphs list. "Accès réservé aux administrateurs" means step 3 used a different email.
6. **Without a database:** `NEXT_PUBLIC_DSA_MOCK=1 npm run admin` opens the mini graph in memory, without sign-in (dev only).
7. **Vercel:**
   - New Project → import the repo → **Root Directory `apps/admin`**. The framework is detected as Next.js.
   - Keep **"Include files outside the root directory in the Build Step"** enabled (the default): the app imports `packages/core`. Vercel installs from the root `package-lock.json` (npm workspaces).
   - **Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. **Do not** set `NEXT_PUBLIC_DSA_MOCK`; it is ignored in production builds anyway. Never add the service role key.
   - Node.js version 20 or 22 (Settings → General).
   - The build downloads the two Google fonts through `next/font`, so it needs network access (Vercel has it).
8. **Recommended:** Authentication → Sign In / Providers → turn off **"Allow new users to sign up"** if players don't need email accounts. Anonymous sign-ins for players are a separate setting and stay on. Anyone who does sign up is refused by the gate and by RLS, but there's no reason to let them create accounts.

## 5. Deviations and interpretations

1. **Auto-layout isn't saved.**
   - The importer leaves `position_x/y` empty, so cards without a saved position get coordinates computed **for the slice on screen**. Laying out all 1,647 nodes globally would spread three levels under a spine question across the width of about 1,200 leaves.
   - The layout choice ("Arbre du livre" / "Couches (dagre)") is a view setting, not an edit.
   - Dragging saves `position_x/y`, as the brief asks.
   - **Ranger** forgets the hand-placed positions of the cards on screen (one undoable step), so they return to the automatic layout.
   - The earlier version saved a layout's positions into the diff; one click put 29 "moves" into the save, so I removed that.
2. **Focus mode:**
   - default depth 3, slider 1–8;
   - double-click a card to focus on it; breadcrumbs lead back to the root;
   - a jump or a search result opens the focus on the node's **parent** and centres on the node, so it arrives with its siblings;
   - cards show "+N enfants masqués" when the depth cuts children off.
3. **Deleting a node deletes its whole subtree** and every edge touching it. The confirmation shows those counts, and the step can be undone. **Deleting an edge renumbers the remaining siblings** 0..n-1, as does "Monter / Descendre", so `order_index` stays gap-free (those renumberings are edge updates in the diff).
4. **Admin-created rows** (S4 report §4.6):
   - nodes, edges and characters get a random v4 id and `metadata.origin = 'admin'`;
   - `node_key` is `NOT NULL`, so new nodes get a key built with the book's rules (`spineChildKey` / `treeChildKey` / `characterKey`), plus `~2`, `~3` on a collision;
   - review status is `DRAFT`, and the page number is copied from the parent.
5. **Edit flags for the importer** (S4 §4.7):
   - editing a node's description sets `metadata.description_edited = true`;
   - editing a character's description or aliases sets `description_edited` / `aliases_edited` on the character.
   - I added character description and alias editing to the node panel, because the Tireur's card shows the character description.
6. **Characters:** `bible_characters` has no `graph_id`, so the editor loads **all** characters (search, assign, validation). "Personnages" in the graphs list and on the review page counts **CHARACTER nodes**, which is why the mini graph shows 13 there while it has 12 character rows (alias leaves share one). Deleting a character isn't offered.
7. **Review page:**
   - "Approuver la page" / "Rejeter" set the status of **every node and edge whose `source_page` is that page**.
   - Rejecting requires a note, which replaces `review_note` on those rows. Approving keeps existing notes; an approved row's note is shown in grey, not amber.
   - Nodes without a `source_page` (START, and the spine questions in the mini fixture) aren't in the table; a line under the table says so and points to the editor.
   - "Modifier" opens the editor on the page's first root, in book order.
8. **Import batch per page:** read from `stats.page` (S4's shape), falling back to `report.page` or the number in `source`. The spine batch (`stats.page = 'spine'`) has no row in the page table. The panel shows the batch status and date, the validation warnings from `report.validation_warnings`, and the raw JSON.
9. **Publishing validates what is saved in the database, not the unsaved draft.** Publishing happens on the graphs list, and it re-loads the graph server-side before running `validateGraph`. The editor's **Valider** tab validates the draft, including unsaved changes.
10. **Aperçu de partie:**
    - runs `GameEngine` on the **draft**, unsaved changes included;
    - "Ne jouer que les nœuds validés" is off by default, so a path can be checked before approval; tick it to play exactly what players would get;
    - it shows the secret on purpose, and offers "Réponse juste" (`aiTireurAnswer`) and a one-click name call once a character is reached;
    - it never touches the game tables.
11. **Saving:**
    - The save isn't a database transaction. PostgREST has no multi-table transaction, and there's no RPC for it.
    - Writes go in FK order in batches of 500: characters, nodes, deleted edges, edges, deleted nodes, deleted characters.
    - If a batch fails, the draft stays unsaved and the error is shown. Saving again re-sends the same diff, which is safe: upserts on `id`, and deleting an already-deleted id is a no-op.
12. **React Flow attribution is kept** (small, top-right). Hiding it is meant for React Flow Pro subscribers, and the library logs a warning otherwise.
13. **Mock mode:**
    - Server state lives on `globalThis` until `next dev` restarts, so publish and review actions show up on re-render.
    - The editor loads and saves in the browser, so an editor save in mock mode isn't seen by the server-rendered review page.
    - Pages 34 and 41 of the fixture are set to NEEDS_REVIEW so the review screens have work on them.
14. **No ESLint config** (`eslint.ignoreDuringBuilds`); typecheck and tests are the gate.
15. **Dev tip:** running `next build` and then `next dev` over the same `apps/admin/.next` produced HTTP 500 `SyntaxError: Unexpected end of JSON input` on the review page. Deleting `apps/admin/.next` fixed it.

## 6. Open questions

1. **Two admins at once.** There is no optimistic locking: the last save wins per row. Is one admin at a time an acceptable rule, or should saves check `updated_at`?
2. **Versioning.** The importer bumps `graph_versions`; admin saves and publishing don't. Should publishing write a `graph_versions` snapshot (and bump `graphs.version`)? It would give a rollback point before each release.
3. **Review of the spine.** The spine questions (START, ANCIEN, HOMME…) have no `source_page` in the mini fixture, so they can only be approved one by one in the editor. Should the importer give them page 2, so they get a row in the review table?
4. **Page approval scope.** "Approuver la page" also approves rows of that page that carry a `{review}` note (the same behaviour as S4's `--approve`). Should it skip or warn about rows that still have a note?
5. **Browser rendering at full scale** (§1) is unmeasured. A quick check with the real data after the first import would confirm "Graphe entier" stays usable.
