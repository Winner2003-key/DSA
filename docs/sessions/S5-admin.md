# Brief S5 — `apps/admin`: graph editor and import review (Next.js + React Flow)

You are a senior React / Next.js engineer and product designer on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game whose question graph comes from a book. Repo: `/home/winner/projects/DSA` (npm workspaces; Node 22).

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no git commit, stay in your folders, French UI)
2. `GAME_RULES.md`, `GRAPH_SPECIFICATION.md` (all, especially §2, §3 and **§7**), `DATABASE_SCHEMA.md`
3. `docs/sessions/reports/S1-core.md` and `S2-database.md`
4. `docs/sessions/S4-importer.md` (running in parallel: it fills the DB and defines what the importer preserves: review status, positions, edited descriptions, admin-created rows with `metadata.origin = 'admin'`)
5. `packages/core/src/index.ts` (reuse `GraphIndex`, `validateGraph`, `formatReport`, the types)

## You own
`apps/admin/**` only. `npm install` for your workspace (on a lock or ENOTEMPTY error, wait 30 s and retry; never delete `package-lock.json`).

## Stack and constraints
- **Next.js** (latest stable, App Router, TypeScript strict), **Tailwind CSS**, **@xyflow/react**, `@supabase/supabase-js` + `@supabase/ssr`, `elkjs` or `@dagrejs/dagre` for auto-layout, and `zustand` for editor state and undo/redo.
- **Deploy on Vercel** (root directory `apps/admin`). Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. **No service role key anywhere in this app.** Commit `.env.example`.
- **Auth:** Supabase email + password sign-in (French UI). After sign-in, call RPC `dsa_is_admin()`; non-admins see "Accès réservé aux administrateurs". Protect every route in middleware or a server layout. All writes go through the user's session, so RLS enforces admin rights.
- **Scale:** the real graph has about 1,650 nodes and 1,650 edges. Rendering everything at once must stay usable. Provide focus mode: a selected subtree (node + N levels, default 3), with breadcrumbs back to the root; "whole graph" is available but virtualized by React Flow's `onlyRenderVisibleElements`.
- **Book-like layout:** a top-down tree, edges labelled with their answer (`OUI`, `NON`, `OUIOUIOUI`, `JE NE SAIS PAS`), children in `order_index` order, CHARACTER nodes rendered as "clue • NAME" cards. Visual distinction per node type and review status (for example a dashed amber border for NEEDS_REVIEW, red for REJECTED).

## Features
1. **Graphs list:** name, slug, status, version, counts, number of NEEDS_REVIEW; open; publish or unpublish (refuse to publish if `validateGraph` has errors, and show them).
2. **Editor** (`/graphes/[slug]`):
   - zoom, pan, minimap, controls, fit view;
   - search nodes by label, clue or key, and search characters, then jump to the result;
   - select a node → side panel: type, label, question (clue), description, source page (+ printed page, extra pages), character (search and assign, or create), group kind, review status and note, metadata JSON (read-only view plus editable notes and variants), node key (read-only);
   - select an edge → answer label, kind, from/to, order (move up or down among siblings), source page, review status;
   - add a child node (appended at the end of the parent's children, `metadata.origin = 'admin'`, random v4 id), delete a node (confirm; show how many descendants and edges are affected), drag to reposition (saves `position_x/y`), connect nodes (creates an edge; its kind is chosen from the source node type), delete an edge, change an edge's answer;
   - **undo/redo** (Ctrl+Z / Ctrl+Shift+Z) for all edits before saving; a **Enregistrer** button saves a batch diff to Supabase with a clear summary; warn before leaving with unsaved changes;
   - a **Valider** panel running `validateGraph` on the in-memory graph, with click-through to the offending node or edge;
   - **Source: page N** shown on every node and edge (the PDF isn't hosted; just show the page numbers);
   - **Aperçu de partie**: play the graph in the browser with `@dsa/core` GameEngine against a chosen secret, to check a path; this is for the admin only.
3. **Import review** (`/graphes/[slug]/revue`, PART 25 of the brief):
   - a table per source page: counts of nodes, edges and characters, and how many are NEEDS_REVIEW / APPROVED / REJECTED, plus the latest `import_batches` report;
   - open a page → a read-only tree of that page's nodes, their `review_note`s and variants;
   - **Approuver la page** / **Rejeter** (with a note) / **Modifier** (opens the editor focused on the page's root);
   - bulk-approve the selected pages (confirm).
4. **Export JSON** of the whole graph (download as `GraphData`) for backup.
5. **Homonyms: descriptions on the Tireur's card** (`/graphes/[slug]/homonymes`, owner request 2026-09-16).
   - **Why:** 110 names belong to several different people (LEMEC, HENOC, ASSUR, HEBER, GOMER, JOAS…). When the Tireur draws a name, the card shows the name plus `bible_characters.description`, and that description is the only way to know **which** person to have discovered.
   - The generated description is `"<clue> · <nearest CATEGORY>"`. It's often too weak when the clue is only an ordinal ("1er · SES FILS": whose sons?).
   - **List:** every name used by 2+ characters, grouped by name. For each person show the current description, the book path (breadcrumb from the root) and the source page. Filters: all / only generic descriptions (clue is an ordinal or a generic word like "1er", "2ème", "Son père", "Le dernier") / already edited.
   - **Edit** the description inline, with a live **preview of the Tireur's card** (NAME large, description small, exactly as the app renders it). Also warn when two people with the same name still have identical descriptions.
   - Save to `bible_characters.description` **and** set `metadata.description_edited = true`, so the importer never overwrites it (IMPORT_GUIDE §8). Keep the CHARACTER node's `description` in sync.
   - The same description field, with the same flag, is also editable from the node panel in the editor (feature 2).
   - Nice to have: "Suggérer" fills in a longer description from the book path (for example `1er · SES PETITS FILS · LIE A SEM`) for the admin to accept or edit. It's never applied automatically.
   - Remember: the description is **only shown to the Tireur when the name is shared** (GRAPH_SPECIFICATION §8), which is exactly the list on this page.
6. **Game settings** (`/reglages`, owner request 2026-09-16): **thinking time** (default 40 s) and **game time** (default 120 s), see GRAPH_SPECIFICATION §9. If the timer session hasn't landed when you build this, build the page against the storage §9 describes and note it in your report. The game must not depend on it yet.

Keep data access in `src/lib/graph-repository.ts` (load a graph into `GraphData`, compute and save a diff), mapping snake_case DB rows ⇄ core camelCase types. Components stay free of Supabase calls.

## Design
Use the `frontend-design` skill: a calm, dense, professional admin UI, desktop-first (≥1280 px) but not broken on a tablet, in French.

## Tests and verification (paste the output in the report)
- `npm run typecheck --workspace apps/admin`
- `npm test --workspace apps/admin` (vitest):
  - row ⇄ GraphData mapping round-trip;
  - diff computation (add, update, delete, reorder, position-only change);
  - undo/redo store;
  - tree layout ordering follows `order_index`;
  - the admin gate redirects non-admins (mocked).
- `npm run build --workspace apps/admin` succeeds.
- If possible, run `next dev` with a mocked repository (`NEXT_PUBLIC_DSA_MOCK=1` loads `packages/core/fixtures/mini-graph.json`, dev only), take screenshots of the editor and the review page with a headless browser, and save them to `docs/sessions/reports/S5-screens/`.

## Report
Write `docs/sessions/reports/S5-admin.md` with:
- the files and outputs;
- the owner's steps (create an admin user in the dashboard, run `02_make_admin.sql`, `.env.local`, `npm run admin`, Vercel settings);
- deviations and open questions.
