# Brief S13 — Admin-editable pronunciation of names (B6)

You are a senior Next.js / PostgreSQL engineer on **DSA — Découverte Sans Alphabet**. Repo: `/home/winner/projects/DSA`.

The phone's voice mispronounces some Bible names and book labels. The admin must be able to fix how each one is said, so players learn the right pronunciation. Implements backlog item **B6**.

**Deferred by the owner on 2026-09-22** ("leave the admin side for now"): start only when the owner says so.

## Read first
1. **`docs/sessions/CONTEXT.md`** — where the project stands. It replaces the old reports.
2. **`docs/sessions/CHECKS.md`** — what to run and when. Follow it.
3. `docs/sessions/README.md`: the global rules.
4. `docs/sessions/BACKLOG.md`: **B6** (and B3, in case recorded voices arrive later).
5. `GRAPH_SPECIFICATION.md` §10 (phrasing and pronunciation), and the `pronunciations`-adjacent
   part of `DATABASE_SCHEMA.md`.
6. `packages/voice/src/{speakable,lexicon.fr}.ts`, and the admin's existing
   `src/app/graphes/[slug]/homonymes/page.tsx` — copy its structure rather than reading its
   report.
**Don't read the old reports end to end, and don't open the old screenshot folders.** If you
need one decision's reasoning, read that report's §1 Files table or search it for the term.


## You own
- `apps/admin/**`;
- `supabase/`: a migration with **the next free number** (check `ls supabase/migrations`), a matching `sql-editor/NN_pronunciation.sql`, its own test file `sql-editor/9N_pronunciation_tests.sql`, the regenerated `00_all_migrations.sql` (only if no other session is mid-flight), and `DATABASE_SCHEMA.md`;
- `packages/voice` and `apps/mobile`: **only** the small change that applies the overrides when speaking, and only if no other session owns `apps/mobile` at that moment. Otherwise leave it, and say so in the report.

## Deliver
- **SQL:** table `pronunciations` — `id`, `graph_id` (nullable: null means "all graphs"), `term`, `term_normalized` (generated from `dsa_normalize`), `spoken_form`, `note`, `updated_by`, `updated_at`; unique on `(graph_id, term_normalized)`; RLS: admins full CRUD, nobody else writes.
  - RPC `dsa_list_pronunciations(p_graph_slug text)` → `(term, spoken_form)` rows only, granted to `authenticated`. It exposes no graph structure, no clues and no secrets.
  - Tests: admin can write and a player can't; the RPC returns only the two columns; anon is refused; graph-specific rows win over global ones.
- **Admin page `/graphes/[slug]/prononciation`:** search the graph's names and question labels, show the current spoken form, edit it, press **Écouter** (browser `speechSynthesis`, with the same voice and speed controls as the app so the admin hears what players hear), and save. Show which terms already have an override, and a filter for "sans prononciation". Link it from the graphs list, the editor header and the Homonymes page.
- **App:** fetch the list once per session (cache it, refresh on app start), and apply it in `packages/voice` `speakablePrompt` / `speakableAnswer` **above** the built-in lexicon: an exact normalized match on the whole label, or on a word inside it. The screen always shows the book's spelling.
- A player-facing note isn't needed; this is silent.

## Tests and verification (paste the output)
- `npm test` / `npm run typecheck` for `apps/admin` (plus `packages/voice` and `apps/mobile` if you touched them); `npm run build --workspace apps/admin`.
- Tests: admin writes and a player cannot; the RPC returns only term and spoken form; anon refused; a graph-specific row beating a global one; overrides applied in `speakablePrompt` (whole label and single word) with the displayed text unchanged; the admin page search, edit and save.
- SQL: `bash supabase/sql-editor/build.sh` to regenerate the bundle — **never hand-edit
  `00_all_migrations.sql`**. Verify the **upgrade path** (an existing project + your new file +
  `90_tests.sql`) with libpg-query and PGlite in your scratchpad; the fresh path only if you
  changed an existing migration (`CHECKS.md` §5).
- Screenshots: the committed harness `tools/screens/` — don't build one. **4 shots maximum**,
  light theme, scale 1, into `docs/sessions/reports/S13-screens/`, each described in a sentence.

## Report
`docs/sessions/reports/S13-pronunciation.md`, **under 1,500 words**: files, outputs, **the
exact SQL file to paste**, deviations and open questions.
