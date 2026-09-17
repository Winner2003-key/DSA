# Brief S11 — "QUESTION" goes back to the opening question, and practising one part of the book

You are a senior full-stack engineer (PostgreSQL / Supabase, TypeScript, React Native / Expo) on **DSA — Découverte Sans Alphabet**. Repo: `/home/winner/projects/DSA`.

This session implements backlog items **B1** (a game-rule change) and **B7** (practise a part of the book) from `docs/sessions/BACKLOG.md`.

**Run one app session at a time:** S9, S10 and S11 all change `apps/mobile`. Check `git status` at the start; if another session's work is uncommitted, stop and tell the owner.

## Read first, completely
1. `docs/sessions/README.md`: global rules. **No Docker**, no commit, French UI. **Public repo: never write the source book's title, author or organisation**; the book graph is `livre`.
2. `GAME_RULES.md` (§3, §4 and the planned-change note) and `GRAPH_SPECIFICATION.md` §2 (traversal rules), §3 (RPCs), §7, §8, §9.
3. **`docs/sessions/BACKLOG.md`: B1 and B7**, including the worked example.
4. Reports: `S1-core.md` (rules and engine), `S2-database.md` (SQL mirror and how it was verified), `S3b-game-ux.md`, `S6-rooms.md`, `S7b-voice-app.md` (the voice intent for "question" doesn't change), and `S9-timed-games.md` if it exists.
5. `packages/core/src/{rules,engine}.ts`, `supabase/migrations/0003_functions.sql` (`dsa_rewind`, `dsa_derive_position`).

## You own
- `packages/core` (the rules change, `solutionPath` untouched) and its tests;
- `supabase/`: a migration with **the next free number** (check `ls supabase/migrations`), a matching `sql-editor/NN_rules_scope.sql`, the regenerated `00_all_migrations.sql`, updated scenarios in `90_tests.sql`, and `DATABASE_SCHEMA.md`;
- `apps/mobile/**`;
- **`GAME_RULES.md` §4 and `GRAPH_SPECIFICATION.md` §2**: replace the "planned change" note with the new rule as built (this is the one session allowed to edit those two documents).

## Deliver

### 1. "QUESTION ×N" goes back to the question that opened the list (B1)
**The owner's rule:** the Tireur says "QUESTION" to send the Découvreur back to the question that **opened the list they're in**, not to the previous question, so a mistake is recovered in one step.

**Definition (from B1; keep it in one place in core and mirror it in SQL):**
- A step **enters a level** when it's a spine answer (a DECISION edge always moves) or a child prompt answered **OUI**.
- A child prompt answered **NON** doesn't enter a level.
- `rewind(N)` finds the **N-th most recent entering step**, undoes it and every step after it, and the prompt becomes that step's question again.
- Fewer than N entering steps → go back to the very first question (don't raise an error for that case; keep `DSA_INVALID_REWIND` only for N outside 1–3 or an empty path).
- Undone steps stay recorded as undone; the stats count one rewind.

**Worked examples to turn into tests:**
- "1ère classe ?" OUI → "1er ?" NON → "2ème ?" NON → **QUESTION ×1** → the prompt is "1ère classe ?" again; answering NON then moves to the next sibling of 1ère classe.
- "LIE A ADAM ?" NON (a mistake) → prompt "LIE A ABRAHAM ?" → **QUESTION ×1** → the prompt is "PENTATEUQUE ?" (the question that opened this list), and the pair asks down again.
- "QUESTION ×2" goes one list higher.
- Right after a spine answer with nothing asked yet, ×1 re-asks that spine question (unchanged from today).

**Also:**
- Update the app's explanation of "QUESTION ×1/×2/×3" (the Tireur's hint text, and the Découvreur's notice when it happens: "Le Tireur demande de revenir à « 1ère classe ? »").
- The voice intent stays the word "question" said 1–3 times (S7b).
- The Découvreur's own "Revenir à une question" (pick any earlier question) is unchanged.
- `dsa_rewind` keeps its signature; only the semantics change. Update `90_tests.sql` scenarios 7 and 8 and their expected paths, and the core tests, rather than adding parallel ones.

### 2. Practise one part of the book (B7)
- **Setup:** in "Préparer la partie" and in room creation (the creator decides), **« Tout le livre »** (default) or **« Choisir une partie »**, which opens a picker of the book's sections as a tree with the number of names on each, and multi-select. The lobby shows the choice read-only.
- **Server:**
  - `settings.scope` = an array of section node ids (empty or absent = the whole book). Validate: approved non-CHARACTER nodes of that graph, reachable from START, at least one playable name in the union; otherwise `DSA_INVALID_SETTINGS` (or `DSA_NO_PLAYABLE_SECRET` when the union is empty).
  - The secret is drawn among playable CHARACTER nodes **inside** the scope; `dsa_redraw_secret` (S9) stays inside it; `dsa_rematch` keeps the scope.
  - New RPC `dsa_list_sections(p_graph_slug)` → for every approved non-CHARACTER node: `node_id`, `label`, `parent_id`, `depth`, `characters` (playable names underneath). **No clues, no names, no leaves.** Granted to `authenticated`.
  - The questions still start at the beginning: scope changes **only** which name is drawn.
- **App:** the picker (a compact tree with counts, "tout cocher" per branch), the chosen scope shown on the game screen ("Partie : Nouveau Testament"), and the end screen unchanged.
- **Offline service:** the same behaviour on the mini fixture.
- Optional, if time allows: remember the last scope in the app settings (S10's store) as a starting point.

## Tests and verification (paste the output)
- `npm test` / `typecheck` for core, voice, mobile (and admin if you touch it); `expo-doctor`; `npx expo export -p web --clear`.
- **Core:** the four rewind examples above, plus rewinding at the very start, N = 2 and 3, and a rewind after a wrong name call.
- **SQL:** the same rewind scenarios in `90_tests.sql` (rewritten 7 and 8), the scope validation, the secret always inside the scope over many draws with a fixed seed or repeated calls, a scope with a single name, an invalid scope, `dsa_list_sections` exposing no leaf, and no secret leak.
- SQL verified like S2 (libpg-query plus PGlite in your scratchpad, not the repo), on a fresh database and on the owner's upgrade path.
- Headless screenshots into `docs/sessions/reports/S11-screens/`: the scope picker, a game with a scope, the Tireur's "QUESTION" hint, and the Découvreur's notice after a rewind.

## Report
Write `docs/sessions/reports/S11-rules-and-practice.md` with:
- the rule as built, with the examples;
- files and outputs;
- **the exact SQL file to paste**;
- what changed in `GAME_RULES.md` and `GRAPH_SPECIFICATION.md`;
- deviations and open questions.
