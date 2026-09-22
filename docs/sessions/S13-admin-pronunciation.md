# Brief S13 — Admin-editable pronunciation of names (B6)

You are a senior Next.js / PostgreSQL engineer on **DSA — Découverte Sans Alphabet**. Repo: `/home/winner/projects/DSA`.

The phone's voice mispronounces some Bible names and book labels. The admin must be able to fix how each one is said, so players learn the right pronunciation. Implements backlog item **B6**.

**Deferred by the owner on 2026-09-22** ("leave the admin side for now"): start only when the owner says so.

## Read first, completely
1. `docs/sessions/README.md`: global rules. **No Docker**, no git commit, French UI. **Public repo: never write the source book's title, author or organisation.**
2. `docs/sessions/BACKLOG.md`: **B6** (and B3, in case recorded voices arrive later).
3. `GRAPH_SPECIFICATION.md` §10 (phrasing and pronunciation), `DATABASE_SCHEMA.md`.
4. Reports: `S5-admin.md`, `S5b-admin-homonyms.md` (admin structure, repository, diff and save), `S7a-voice.md` and `S7b-voice-app.md` (where the app speaks), `S2-database.md` (verifying SQL without Docker).
5. `packages/voice/src/{speakable,lexicon.fr}.ts`.

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
- SQL verified like S2 (libpg-query plus PGlite in your scratchpad, not the repo), on a fresh database and on the owner's upgrade path.
- Screenshots into `docs/sessions/reports/S13-screens/`.

## Report
`docs/sessions/reports/S13-pronunciation.md`: files, outputs, **the exact SQL file to paste**, deviations and open questions.
