# Project context — read this instead of the old reports

**Maintained by the lead session. Updated after every session is reviewed.**

This file exists so a new session does not have to read eight previous reports and
a hundred screenshots to know where the project stands. Read this, then your brief,
then only the *named* sections your brief points you at.

---

## 1. What DSA is

A French Bible-name discovery game, digitized from a printed book. Two roles:

- the **Tireur** draws a secret name and answers;
- the **Découvreur** asks the book's questions in the book's order and narrows down to the name.

The Découvreur never sees the graph or the secret. The book's own path to the name is
revealed only at the end of the game, animated.

Everything the game asks comes from the book's decision graph. **Nothing is invented,
guessed or generated.** `GAME_RULES.md` and `GRAPH_SPECIFICATION.md` are the contract.

## 2. The repo

npm workspaces, Node ≥ 20.

| Path | What | State |
|---|---|---|
| `packages/core` | pure TS: graph types, traversal rules, engine, intents, validator, book parser, `solutionPath`, `clock`, `scope` | 200 tests |
| `packages/voice` | loudness envelope (OUI vs OUIOUIOUI), calibration, answer decision, speakable French, transcribe client | 165 tests |
| `apps/mobile` | the Expo app (Expo Router, SDK 57), French UI, web + native | 233 tests |
| `apps/admin` | Next.js 15 admin: graphs, graph editor, import review, homonyms, réglages | works |
| `scripts` | `@dsa/scripts`: book validator, Supabase importer, graph export | 64 tests |
| `supabase/` | `migrations/*.sql` and the paste-ready `sql-editor/*.sql` | 0001–0010 |
| `data/book/` | the private transcription | **gitignored, never copied into tracked files** |
| `tools/screens` | the shared screenshot harness | see `CHECKS.md` |

## 3. The graph model, in one paragraph

Two layers. A **decision spine** of QUESTION nodes joined by DECISION edges that carry an
answer code (`OUI`, `NON`, `OUIOUIOUI`, `NONONONON`, `JE NE SAIS PAS`), and **name trees**
of CATEGORY / GROUP nodes whose HIERARCHY children are in the book's order — answering OUI
descends into a child, NON moves to the next sibling. The number of repetitions in
OUIOUIOUI is never significant: it is one held sound (`answerClass()`). Node keys are
stable paths; ids are UUID v5 over `graphSlug:DSA_ID_SALT:key`, salted for every graph but
the unsalted `mini` fixture, so a leaf name cannot be recovered from an id.

## 4. The app as it stands

Routes: `app/index.tsx` (Accueil) · `jouer/` (Préparer la partie) · `ami/` (create a room) ·
`rejoindre/` (join by code, link or QR) · `partie/[sessionId]` (the game table) ·
`resultat/[sessionId]` · `voix.tsx` (voice calibration and settings).

Modes: solo against the AI (either role), two players on one phone (starts with the Tireur),
and a room on two phones over Supabase Realtime with a polling fallback.

Built and working: the conversation view, the book-like animated path graph at the end,
homonym-only name descriptions, direct question phrasing ("Ancien ?", never "Est-ce Ancien ?"),
rooms with lobby / QR / presence / rematch, voice play with hold-to-talk and free talk,
the held-OUI calibration, the optional chronometer (40 s thinking + 120 s game), name changes
before the start, and the book's path shown after every game.

Design language: a chalkboard-and-brass identity, Zilla Slab, light and dark themes.

## 5. The server

Supabase, server-authoritative. Every move goes through an RPC — `dsa_create_session`,
`dsa_join_session`, `dsa_get_my_secret`, `dsa_get_state`, `dsa_ask`, `dsa_answer`,
`dsa_guess`, `dsa_confirm_guess`, `dsa_go_back`, `dsa_rewind`, `dsa_tireur_ready`,
`dsa_rematch`, `dsa_redraw_secret`, `dsa_get_solution_path`, `dsa_check_time`,
`dsa_list_names` — with RLS on all tables. `game_secrets` is excluded from realtime and is
never readable by the Découvreur. A Supabase Edge Function `transcribe` does speech-to-text
(Groq `whisper-large-v3-turbo`, Hugging Face fallback), rate-limited.

**No Docker, ever.** SQL reaches the database only as numbered files the owner pastes into the
hosted dashboard's SQL Editor. `supabase/sql-editor/build.sh` regenerates `00_all_migrations.sql`
from `supabase/migrations/*.sql` — never edit that file by hand.

## 6. Ground rules that have cost time before

- **The GitHub repo is public and every push to `main` deploys to Vercel.** Never write the
  source book's title, author or organisation into any tracked file, and never copy content
  from `data/` or `DIGITIZATION_REPORT.md`. Bible names are fine. The book graph's slug is `livre`.
- **The Découvreur must never receive the secret** — not the name, not the id, not the description.
  There are tests for this; keep them passing.
- The UI is French. Code, comments and documents are English.
- Don't `git commit`. The lead commits after review.
- Only one session at a time owns `apps/mobile`. Run `git status` first; if another session's
  work is uncommitted, stop and say so.
- Questions are spoken **directly**: "Ancien ?", "Homme ?" — never "Est-ce Ancien ?".

## 7. Where to look, instead of reading a whole report

| You need | Read |
|---|---|
| the rules and how they are worded | `GAME_RULES.md` |
| the graph, RPCs, reveal rules, voice phrasing | `GRAPH_SPECIFICATION.md` (the §s your brief names) |
| the tables and columns | `DATABASE_SCHEMA.md` |
| what an earlier session built and why | that report's **§1 Files** table only |
| what a screen looks like | the report's **Screens** section in words; open at most 3 images |
| the exact commands to run | `docs/sessions/CHECKS.md` |
| owner remarks not yet scheduled | `docs/sessions/BACKLOG.md` |
