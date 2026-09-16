# Report S3b — game UX iteration

**Status: done.** Every change the owner asked for is implemented, tested and verified:
- **SQL:** `0006_game_ux.sql`, the paste-ready `03_game_ux.sql`, the regenerated `00_all_migrations.sql` and new tests in `90_tests.sql`. Checked with `libpg-query` and PGlite on a fresh database, and on the owner's upgrade path.
- **Core:** the additive `packages/core` changes.
- **Mobile:** the app work.

**Test results:**
- core: 170 tests (164 before);
- mobile: 62 tests (35 before);
- scripts: 64 tests, unchanged;
- all typechecks clean;
- `expo-doctor`: 21/21;
- the web export succeeds.

Headless-browser screenshots cover every requested state at 390 px and 1280 px, in light and dark, with **0 page errors and 0 console errors**. Nothing was committed.

**Not verified:** Expo Go on a real phone (pinch, haptics, SVG animation on native) and the hosted Supabase project. As in S3, those are the owner's first run.

---

## 1. What the owner must paste into Supabase

**The project already ran the old `00` and `01`, which is the owner's case.**
1. SQL Editor → New query → paste **all** of `supabase/sql-editor/03_game_ux.sql` → **Run**. Expect `Success. No rows returned`.
2. Paste **all** of `supabase/sql-editor/90_tests.sql` → **Run**. Expect one row: **`ALL DSA TESTS PASSED`**.

**Notes:**
- `03` is safe to run twice.
- The new `90` refuses to run on a project that skipped `03`, with this message: `DSA TEST SETUP: this project predates the game UX update; run 03_game_ux.sql (or the new 00_all_migrations.sql) first`.
- A **new** project runs `00 → 01 → 90` as before. The regenerated `00` already contains 0006.

**What changes on the server:**

| Object | Change |
|---|---|
| `game_sessions.settings` | new `jsonb not null default '{}'`, CHECK: is an object |
| `dsa_create_session` | **dropped and recreated** with a 5th argument `p_settings jsonb default '{}'`. Only `input_mode` ∈ `VOICE`/`BUTTONS` is accepted; it's stored normalized (`{"input_mode":"BUTTONS"}` by default). Anything else → `DSA_INVALID_SETTINGS`. The old 4-argument function is gone, so PostgREST has no overload ambiguity. |
| `dsa_get_my_secret` | **dropped and recreated**, returns `(node_id, name, description, has_homonyms)` |
| `dsa_get_state` (via `dsa_state_json`) | `path[]` gains `prompt_kind`, `node_type`, `target_text`; the state gains `settings` |
| `dsa_get_revealed_path` | same `path[]` fields; `stats: {questions, non, backs, rewinds}`; `secret.has_homonyms` |
| new internal functions | `dsa_has_homonyms`, `dsa_game_stats`, `dsa_normalize_settings`. EXECUTE is revoked from `anon` and `authenticated`, and a test checks it. |
| grants | re-applied for the three recreated or changed RPCs (`authenticated` only) |

## 2. Verification output

### SQL (no Docker)

The tools are in the scratchpad, not the repo: `libpg-query` 17 (the real PostgreSQL parser) and `@electric-sql/pglite` (Postgres in WASM). The Supabase shim is the same as S2's:
- the roles `anon`, `authenticated` and `service_role`;
- `auth.users` and `auth.uid()` reading `request.jwt.claims`;
- `uuid-ossp` in `extensions`, with usage granted;
- Supabase's default privileges;
- an empty `supabase_realtime` publication.

```
== syntax (libpg-query)
OK   migrations/0001_graph_schema.sql  29 statements (1 functions)
OK   migrations/0002_game_schema.sql  16 statements (0 functions)
OK   migrations/0003_functions.sql  114 statements (48 functions)
OK   migrations/0004_rls.sql  45 statements (0 functions)
OK   migrations/0005_realtime.sql  4 statements (0 functions)
OK   migrations/0006_game_ux.sql  24 statements (8 functions)
OK   sql-editor/00_all_migrations.sql  232 statements (57 functions)
OK   sql-editor/01_seed_mini_graph.sql  10 statements (0 functions)
OK   sql-editor/02_make_admin.sql  2 statements (0 functions)
OK   sql-editor/03_game_ux.sql  24 statements (8 functions)
OK   sql-editor/90_tests.sql  43 statements (14 functions)

== fresh project: 00 → 01 → 90 (every file twice)
OK   sql-editor/00_all_migrations.sql (run 1)
OK   sql-editor/00_all_migrations.sql (run 2)
OK   sql-editor/01_seed_mini_graph.sql (run 1)  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   sql-editor/01_seed_mini_graph.sql (run 2)  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   sql-editor/90_tests.sql (run 1)  [{"result":"ALL DSA TESTS PASSED"}]
OK   sql-editor/90_tests.sql (run 2)  [{"result":"ALL DSA TESTS PASSED"}]

== owner's upgrade: 00(old) → 01 → 90(old) → 03 ×2 → 90 ×2 → 00(new) again → 90
OK   sql-editor/00_all_migrations.sql            (the pre-S3b file, saved before any edit)
OK   sql-editor/01_seed_mini_graph.sql  [{"mini_nodes":30,"mini_edges":29,"mini_characters":12}]
OK   sql-editor/90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]   (old tests, old schema)
OK   sql-editor/03_game_ux.sql (run 1)
OK   sql-editor/03_game_ux.sql (run 2)
OK   sql-editor/90_tests.sql (run 1)  [{"result":"ALL DSA TESTS PASSED"}]
OK   sql-editor/90_tests.sql (run 2)  [{"result":"ALL DSA TESTS PASSED"}]
OK   sql-editor/00_all_migrations.sql            (new 00 re-run on the upgraded project)
OK   sql-editor/90_tests.sql  [{"result":"ALL DSA TESTS PASSED"}]

== new 90 on a project that skipped 03
FAIL sql-editor/90_tests.sql
     DSA TEST SETUP: this project predates the game UX update; run 03_game_ux.sql (or the new 00_all_migrations.sql) first

== mutation 1: dsa_has_homonyms ignores character_id
FAIL sql-editor/90_tests.sql
     DSA TEST FAILED [13 game UX homonyms]: ABRAM with a second leaf of the same person: expected 'false', got 'true'

== mutation 2: target_text leaks a CHARACTER's name
FAIL sql-editor/90_tests.sql
     DSA TEST FAILED [1 secret CAÏN normal play]: revealed path fields (0006): expected '… > Le meurtrier:CHILD:CHARACTER:-', got '… > Premier homme:CHILD:CHARACTER:ADAM > Le meurtrier:CHILD:CHARACTER:CAÏN'
```

`03_game_ux.sql` minus its 14-line header is byte-identical to `0006_game_ux.sql` (checked with `diff`).

**What `90_tests.sql` gained:**
- **Scenario 1 (CAÏN):**
  - the fields of all 7 path entries (`ANCIEN:SPINE:QUESTION:HOMME` … `Le meurtrier:CHILD:CHARACTER:-`), and the state path equal to the revealed path;
  - `stats = {"non": 1, "backs": 0, "rewinds": 0, "questions": 7}`;
  - `has_homonyms = false`.
- **Scenario 4 (DAVID):** all path fields, and `target_text = 'LIE A DAVID'` after `OUIOUIOUI`.
- **Scenario 7:** `stats = {non 2, backs 0, rewinds 1, questions 8}`. Undone moves are counted.
- **Scenario 9:** `stats = {non 2, backs 1, rewinds 0, questions 5}`.
- **Scenario 12 (security):**
  - at every prompt, the new fields never contain the secret's name;
  - no CHARACTER `node_type` appears before the secret's clue;
  - SPINE ⇔ `target_text` not null;
  - `has_homonyms` never appears before the end;
  - the Tireur's `has_homonyms` is false;
  - the four new internal functions return 42501 for the Découvreur.
- **Block 13, homonyms:**
  - JACQUES is true, both through `dsa_get_my_secret` and in the revealed secret, and its description is checked;
  - CAÏN, ABRAM and ABRAHAM are false;
  - an extra leaf **"Abram" with ABRAM's `character_id`** is still false;
  - the same leaf pointing at **another person** is true;
  - the same leaf un-approved is false;
  - the extra rows are deleted again, and the test checks there are 30 nodes.
- **Block 13, settings:**
  - the default, `{}`, `null`, `VOICE` passed by named arguments (as supabase-js sends them) and `BUTTONS` all store the right value;
  - rejected: an unknown mode, lower case, a number, an unknown key, an extra key and a JSON array;
  - the 4-argument function no longer exists;
  - the EXECUTE grants for `authenticated` and `anon` are as expected.

### packages/core

```
$ npm test --workspace packages/core
 Test Files  11 passed (11)
      Tests  170 passed (170)
$ npm run typecheck --workspace packages/core
> tsc --noEmit            (exit 0)
```

New file `test/game-ux.test.ts` (6 tests):
- `hasHomonyms` is true for JACQUES, false for CAÏN, ABRAHAM and ABRAM, and handles the same-person, other-person and unapproved cases;
- `revealedPath` returns `nodeType` and `targetText` for scenarios 1 and 4.

### apps/mobile

```
$ npm run typecheck --workspace apps/mobile
> tsc --noEmit            (exit 0)

$ npm test --workspace apps/mobile
PASS tests/path-layout.test.ts
PASS tests/supabase-errors.test.ts
PASS tests/offline-game.test.tsx
PASS tests/homonym-description.test.tsx
PASS tests/decouvreur-conversation.test.tsx
PASS tests/decouvreur-never-sees-the-secret.test.tsx
PASS tests/local-tireur-first.test.tsx
PASS tests/question-phrasing.test.tsx
Tests:       62 passed, 62 total          (no console errors or act() warnings)

$ npx expo-doctor
21/21 checks passed. No issues detected!

$ npx expo export -p web --clear
› web bundles (1): _expo/static/js/web/entry-….js (2.7MB)
Exported: dist
```

`scripts/` (untouched) still type-checks and passes its 64 tests against the changed core.

**What the new mobile tests prove:**
- **`path-layout.test.ts`** (9 tests), on paths played through the real offline service:
  - a spine step goes **down**, labelled with its answer, into the section named by `target_text`;
  - a spine answer that leads to the next question doesn't draw that question twice;
  - `OUIOUIOUI` → `LIE A DAVID`;
  - **NON goes right** on the same line;
  - **OUI on an item goes down** into it, and TOME/PÈRE DE LA FOI are GROUP boxes;
  - a run of 4 NON **wraps** onto new lines at 2 columns, using an elbow edge, and the layout stays under 500 px wide;
  - the **name comes last**, starred, joined by the final OUI, with a description only when one is given; a name called early hangs on a dashed line;
  - **no node for unused branches or undone steps**, checked after a rewind, with one beat per step;
  - an empty path, word wrapping, and `fitRect`.
- **`homonym-description.test.tsx`** (6 tests):
  - on the Tireur card, the description is hidden for CAÏN (`has_homonyms: false`) and shown for JACQUES (`true`); face down, neither the name nor the description is in the tree;
  - the same two cases on the **result header**;
  - the result prints the server's stats.
- **`decouvreur-conversation.test.tsx`** (4 tests):
  - after 6 real exchanges, the latest pair is "Premier homme ?" with **its own** NON;
  - every earlier row `exchange-i` contains exactly question i and answer i;
  - the "Question suivante" card holds "Le meurtrier ?" and **no answer word at all**, and that question isn't in the pair above it;
  - the **waiting** state shows "Tu as demandé HOMME ?" and "Le Tireur réfléchit…" with no answer and no Ask button, while the pair above is still ANCIEN/OUI;
  - a refused call "Tu as proposé ABSALOM → NON" is its own pair;
  - at a **dead end**, "Plus de question dans cette liste" shows, with "Revenir à une question".
- **`local-tireur-first.test.tsx`** (2 tests), which drive the real `GameTable`, `useGame` and offline service:
  - "Passe le téléphone au Tireur", with nothing rendered behind it;
  - the Tireur turns the card (CAÏN);
  - "C'est bon, je suis prêt" leads to "Passe le téléphone au Découvreur", and the card is gone from the tree;
  - the first question, ANCIEN;
  - asking hands the phone back, and the Tireur's pad shows only OUI and NON;
  - a LOCAL game that already has answers doesn't repeat the hand-over.
- **`question-phrasing.test.tsx`** (3 tests, the owner's mid-session rule, see §5.13):
  - no string in `fr.ts` contains "Est-ce", including the string builders;
  - the Découvreur card shows `HOMME ?` and TTS says it that way;
  - the Tireur's incoming question shows `ANCIEN ?` and TTS says it that way; a name call is shown and spoken as `ABSALOM ?`;
  - neither rendered tree contains "Est-ce", and nothing TTS said contains it (checked through the `expo-speech` mock).
- **Existing tests:**
  - `offline-game` checks the new stats, `has_homonyms` and path fields;
  - `supabase-errors` checks `p_settings`, the parsing of the new fields and `DSA_INVALID_SETTINGS`;
  - `decouvreur-never-sees-the-secret` passes with its fixtures updated to the new shapes.

## 3. Screenshots — `docs/sessions/reports/S3b-screens/`

**How they were made:**
- a web build with `EXPO_PUBLIC_DSA_OFFLINE=1`, served locally;
- Playwright with the system Chrome;
- sound muted;
- 390×844 at 2× and 1280×860 at 1×, each in `dark` and `light`.

File names are `<width>-<theme>-<nn>-<state>.png`, so the full set is 16 states × 4 variants. The whole run logged **0 page errors and 0 console errors**.

| nn | State |
|---|---|
| 01 | Préparer la partie (role and mode, Façon de jouer: Voix disabled "Bientôt" / Boutons) |
| 02 | LOCAL: "Passe le téléphone au Tireur" |
| 03 | LOCAL: the Tireur's card, face down |
| 04 | LOCAL: card turned over, "C'est bon, je suis prêt" |
| 05 | LOCAL: "Passe le téléphone au Découvreur" |
| 06 | Découvreur: first question card |
| 07 | Tireur answering: "Le Découvreur demande PENTATEUQUE ?" (OUI / NON / NON NON NON only) |
| 08 | Découvreur **answered**: earlier exchanges, "Tu as demandé PENTATEUQUE ?" → NON, then the separate "Question suivante" card |
| 09 | Découvreur **dead end**: "Plus de question dans cette liste" with "Revenir à une question" as the primary button |
| 10 | Tireur: **name call** "Le Découvreur propose ABSALOM", OUI / NON |
| 11 | Découvreur: "Tu as proposé ABSALOM" → NON, dead end still offered |
| 12 | "Voir le chemin" during play (no animation, answered steps only; the last NON ends on a stub) |
| 13 | Découvreur **asked, waiting**: "Tu as demandé ANCIEN ?" + "Le Tireur réfléchit…" (AI_TIREUR, header seat "Tireur · IA" active) |
| 14 | Découvreur: clue reached, "C'est le bon indice" |
| 15 | Result: path graph **mid-animation** (camera close on the current step) |
| 16 | Result: graph **fully zoomed out**, JACQUES ★ with its description (a homonym), stats from the server |

## 4. Files

### SQL (`supabase/`)

| File | Change |
|---|---|
| `migrations/0006_game_ux.sql` | new: all server changes of §1, re-runnable |
| `sql-editor/03_game_ux.sql` | new: the same content with an owner header |
| `sql-editor/00_all_migrations.sql` | regenerated with `build.sh` (6 migrations) |
| `sql-editor/90_tests.sql` | precondition for 0006, `dsa_test.path_fields`, the additions listed in §2 |
| `sql-editor/README.md` | "Upgrading a project that already ran 00 and 01" |
| `migrations/0003_functions.sql` | **one line added** (see deviation 1) |
| `DATABASE_SCHEMA.md` | `settings` column, the new RPC signatures and JSON shapes, stats semantics, the internal functions, the setup note for `03`, two troubleshooting rows |

### Core (`packages/core`, additive)

| File | Change |
|---|---|
| `src/homonyms.ts` | new: `hasHomonyms(ix, nodeId)` |
| `src/types.ts` | `PathStep` STEP gains `nodeType` and `targetText` |
| `src/engine.ts` | `revealedPath` fills them (the SPINE target goes through `childPromptText`, so a CHARACTER target would show its clue) |
| `src/index.ts` | exports `hasHomonyms` |
| `test/game-ux.test.ts` | new, 6 tests |

### Mobile (`apps/mobile`)

**Dependency:** `react-native-svg` 15.15.4, added with `npx expo install` (it is included in Expo Go). The root `package-lock.json` was updated by that install.

**Services and state:**

| File | What changed |
|---|---|
| `src/services/types.ts` | `PathEntry` gains `prompt_kind`, `node_type` and `target_text`. New `GameSettings`/`InputMode` and `DEFAULT_SETTINGS`. `GameState.settings`, `Secret.has_homonyms`, `cardDescription()`, `GameStats`, `RevealedPath.stats`, `CreateSessionOptions.settings`. |
| `src/services/supabase-game-service.ts` | sends `p_settings`; parses the new fields and tolerates a server that hasn't run `03` |
| `src/services/offline-game-service.ts` | mirrors the server: `normalizeSettings` (same rules and error), `has_homonyms` through core, `stats` from `engine.stats`, and the path fields |
| `src/state/use-game.ts` | the LOCAL phase `TIREUR_READY` and `confirmTireurReady`; `outgoing` (what was just asked or called); `exchanges`; the AI Tireur answer beat (`AI_ANSWER_BEAT_MS` = 700); client-side back counting removed |
| `src/state/exchanges.ts` | new: `buildExchanges` and `pruneGuesses`, the question→answer pairs plus refused calls |
| `src/state/game-stats.ts` | **deleted** (the server now counts) |

**The graph:**

| File | What changed |
|---|---|
| `src/graph/path-layout.ts` | new: pure layout (`layoutPath`, `wrapText`, `fitRect`) with nodes, edges, stubs and animation beats |
| `src/components/path-graph.tsx` | new: SVG edges drawn with an animated `strokeDashoffset`, node boxes by kind, answer stamps. The camera follows each beat, then fits the whole path. Pan and pinch (gesture-handler), mouse wheel on the web, zoom chips, "Tout voir" and "Rejouer l'animation". Reduced motion is respected. |
| `src/components/path-sheet.tsx` | new: "Voir le chemin" during play |

**Other components:**

| File | What changed |
|---|---|
| `src/components/answer-stamp.tsx` | new: book-coloured answer tag or bubble with a "stamp in" animation |
| `src/components/game-header.tsx` | new: the two seats (IA / Toi), turn indicator, question counter, and an empty `timer-slot` reserved for §9 |
| `src/components/conversation.tsx` | new: `ExchangePair` and `EarlierExchanges` |
| `src/components/secret-card.tsx` | rewritten: a physical card you tap to flip; the description shows only when the name is shared |
| `src/components/result-header.tsx` | new: name with the homonym rule, a short success animation with haptics, server stats |
| `src/components/choice-card.tsx` | new: radio card for the setup screen |
| `src/components/buttons.tsx` | `LinkButton`; `Chip` gains `accessibilityLabel` and a square minimum |
| `src/components/pass-phone.tsx` | "Je suis le Tireur" / "Je suis le Découvreur"; per-role testIDs |
| `src/components/index.ts` | exports updated |
| `answer-echo.tsx`, `prompt-card.tsx`, `revealed-path.tsx` | **deleted** (replaced) |

**Views and screens:**

| File | What changed |
|---|---|
| `src/views/game-table.tsx` | new: header plus whose view, with the LOCAL hand-over order and nothing rendered behind the hand-over screen |
| `src/views/tireur-ready-view.tsx` | new: "Regarde ta carte" |
| `src/views/decouvreur-view.tsx` | rewritten as a conversation |
| `src/views/tireur-view.tsx` | rewritten: big incoming question or name call, only the allowed answers, a separate "Tu t'es trompé ?" zone |
| `app/jouer/index.tsx` | now **Préparer la partie**: role/mode and Façon de jouer (Voix disabled, Bientôt / Boutons); reads `?mode=` |
| `app/partie/[sessionId].tsx` | uses `GameTable` |
| `app/resultat/[sessionId].tsx` | `ResultHeader` and the animated `PathGraph`. "Rejouer" goes back to Préparer la partie with the same mode. |

**Theme, strings and docs:**

| File | What changed |
|---|---|
| `src/theme/colors.ts` | answer colours from book page 2, in both themes |
| `src/theme/spacing.ts` | every touch target is at least 56 (answers 72) |
| `src/i18n/fr.ts` | setup, table, conversation, ready, graph and Tireur strings; `asQuestion()` (the book label plus a non-breaking space and "?"); `INVALID_SETTINGS`; every "Est-ce" removed; `spoken.question`/`spoken.guess` are the bare label plus "?"; the repeated codes are spoken "Ouiiii !" / "Nonnnn !" |
| `README.md` | layout section |

**Tests:** 5 new files (§2); 3 existing files updated.

## 5. Deviations and decisions

1. **One line added to `0003_functions.sql`, outside the files I own.**
   - The line: `drop function if exists public.dsa_get_my_secret(uuid);` just before its `create or replace`.
   - Without it, re-running the regenerated `00` on a project that already has 0006 fails with "cannot change return type of existing function". S2 documented `00` as re-runnable.
   - Verified: new `00` re-run on an upgraded project → OK → `90` PASSED.
2. **`dsa_get_state` also returns `settings`.** It wasn't asked for, but in S6 the second player of a room must read the input mode the creator chose. It's additive.
3. **`stats` counts every move, undone ones included**, exactly like `GameEngine.stats()`:
   - `non` counts only the plain `NON` class (not `NONONONON`);
   - the result screen shows "N retours" = backs + rewinds.
4. **`dsa_get_my_secret` still returns `description` when `has_homonyms` is false.** The rule is applied by clients (`cardDescription`), so the admin and future screens still get the text. Should the server null it instead?
5. **`target_text` is computed with `dsa_prompt_text`**, so if a DECISION edge ever pointed directly at a CHARACTER, it would carry the clue, not the name. A mutation test proves a name leak would be caught.
6. **Layout limits.**
   - **Unknown target type.** When the **last** answered step is a SPINE step (for example, a name called right after `ANCIEN = OUI`), the entered node is drawn as a section box even if it is really the next question. `target_text` doesn't say which. Mid-path it is always right, because the next step reveals it.
   - **Stubs.** During play, the last answer (which leads nowhere yet) is drawn on a short stub ending in a dot, so it isn't lost; the question being asked is never drawn.
   - **Estimated text width.** Text is wrapped from an estimated glyph width (0.6 em). The screenshots show it fits Zilla Slab, but a much wider font would overflow the boxes.
7. **The AI Tireur answer beat (700 ms, client-side).** The AI answers in the same RPC. Without a pause, "Le Tireur réfléchit…" would never be visible and the answer would replace the question in one frame, which is the confusion the owner reported. Tests set it to 0.
8. **Refused name calls are remembered by this device only** (`exchanges`). The server state doesn't list them, so a reload, or the other device in a room, won't show "Tu as proposé X → NON". See open question 1.
9. **`TIREUR_READY` is remembered in memory per session.** A reload during that step shows it again; once any question is answered, it is never shown again.
10. **The answer colours now follow the book**, replacing S3's warm/cool scheme:
    - **Amber vs brass.** NON is amber, close to the brass used for actions. To keep them apart, answers are always drawn as turned, inked stamps with their word, never as brass slabs.
    - **The Tireur's buttons** use the same book colours, with the repeat mark on the repeated codes.
11. **Every touch target is at least 56 pt** (chips, secondary buttons, sound toggle). The S3 chips were 44.
12. **"Rejouer" goes through Préparer la partie** ("before every game"), with the previous mode preselected. The Voix/Boutons choice isn't remembered between games; while Voix is disabled, that changes nothing.
13. **Owner change during the session: direct questions** (GAME_RULES "How questions are said", GRAPH_SPECIFICATION §10).
    - Every question on screen and in TTS is the book label plus "?": `ANCIEN ?`, `LIE A ADAM ?`, `Le meurtrier ?`. This covers the "Question suivante" card, the conversation bubbles, the Tireur's "Le Découvreur demande" card, name calls, and what the Découvreur's and the Tireur's screens say out loud.
    - "Est-ce" no longer appears anywhere in `apps/mobile`; a test checks this.
    - I also switched the spoken repeated codes to the held sound of §10 ("Ouiiii !" / "Nonnnn !").
    - **Not done here, because it's outside this brief:** the §10 speakable-form lexicon (`packages/voice`: "LIE A" → "lié à") and the intent matcher accepting the bare label as ASK. TTS currently reads the book spelling as printed, for example "LIE A ADAM ?".
14. **The "?" never wraps onto its own line.** It is joined to the label with a non-breaking space, which is also correct French typography.
15. **The graph is SVG edges plus absolutely positioned React Native views** for nodes and stamps. Text uses the loaded Zilla Slab on every platform, and the stamps can animate. The whole canvas is one transformed view, which is the "camera".

## 6. Open questions

1. **Should refused name calls live on the server?** Adding `guesses: [{after_steps, name}]` (live only) to `dsa_get_state` would make "Tu as proposé X → NON" survive a reload and appear on both devices of a room. It reveals nothing new, since the Découvreur made the call. Recommended before S6.
2. **Target type for a final spine step** (deviation 6): add `target_node_type` to path entries? It's one more field and still reveals nothing new.
3. **Should `dsa_get_my_secret` return `description = null` when there's no homonym** (deviation 4)?
4. **Stats wording:** should "questions" count undone questions (the current behaviour, which measures effort), or only the path length?
5. **Real-device checks still needed:**
   - pinch/pan and the `strokeDashoffset` animation on Android/iOS in Expo Go (checked on web only);
   - haptics.

## 7. Notes for S6 (rooms)

- **Settings:**
  - The creator's choice is `createSession({ mode: 'HUMAN_VS_HUMAN', role, settings: { input_mode } })`.
  - The joiner reads `state.settings.input_mode`, which `SupabaseGameService` already parses.
  - Show the setup screen's "Façon de jouer" to the creator only, and read-only to the joiner.
- **Header:**
  - `GameHeader` already shows the other player's `display_name` and "Le Tireur/Découvreur réfléchit…" when the turn isn't this device's.
  - Handle `status = WAITING` before the redirect in `app/partie/[sessionId].tsx` (S3 note).
- **The conversation in rooms:**
  - The waiting card reads `awaiting = ANSWER` (question) or `GUESS_CONFIRM` (`pending_guess`), so it already works when the answer arrives by realtime.
  - `DecouvreurView` stamps the new answer in and plays haptics when `exchanges` gains an entry, whatever the source.
  - Refused name calls from the other device won't appear (open question 1).
- **Hand-over:** `GameTable` hand-over logic applies to LOCAL only; a room device shows `myRoles[0]`.
- **The §9 thinking phase** replaces `localPhase === 'TIREUR_READY'` (`use-game.ts`) with a server phase. `TireurReadyView` is where the countdown goes, and `GameHeader`'s `timer-slot` is where the ring goes.

## 8. Notes for S7 (voice)

- **Where the choice lives:** "Voix" is the `input-voice` `ChoiceCard` in `app/jouer/index.tsx`. It's rendered `disabled` with the "Bientôt" badge. To enable it, remove `disabled`/`badge` when `SpeechToText.available` is true.
- **Reading the mode:** the value reaches the server as `settings.input_mode = 'VOICE'` (already accepted by `dsa_create_session` and the offline service) and comes back in `state.settings.input_mode`. Views branch on it: show the microphone when `VOICE`, keep the buttons always (spec §1).
- **Where input plugs in:**
  - **Tireur:** the answer pad in `TireurView` (`answer-pad`) is the place for the listen button and the borderline two-button choice. It already shows only `prompt.answer_classes`, which is the classifier's decision set. Voice must end in `game.answer(CANONICAL_LABEL[cls])`, exactly like the buttons.
  - **Découvreur:** `ask-button` / `propose-name` in the "Question suivante" card; `useNames()` provides the list for `matchIntent`.
  - **"QUESTION ×N":** the `rewind-zone` in `TireurView` maps to `game.rewind(n)`.
- **Speech output:** the Découvreur view speaks the answer, then the next question, as one utterance. The Tireur view speaks the incoming question or name call. Stop TTS before recording (S3 note).
