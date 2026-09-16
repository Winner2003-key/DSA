# Brief S3b — Game UX iteration: clearer Découvreur, book-like path graph, engaging UI

You are a senior React Native / Expo engineer and product designer, with solid PostgreSQL skills, on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game. Repo: `/home/winner/projects/DSA` (npm workspaces; Node 22). The owner has played the app built in S3 on the real book and asked for the changes below.

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no git commit, stay in your folders, French UI)
2. `GAME_RULES.md` and `GRAPH_SPECIFICATION.md`, **all of it, especially §7, §8 (this iteration's contract) and §9 (planned timer: do NOT implement it)**
3. `DATABASE_SCHEMA.md`
4. `docs/sessions/reports/S3-expo.md` (the app you are changing) and its screenshots in `docs/sessions/reports/S3-screens/`
5. `docs/sessions/reports/S2-database.md` (how the SQL was verified without Docker) and `S4-importer.md`
6. On page 2 of the book, the answer tags are coloured: OUI green, NON yellow/amber, OUIOUIOUI red, JE NE SAIS PAS blue. You don't have the book; use this description.

## You own
- `apps/mobile/**`;
- `supabase/migrations/0006_*.sql`, `supabase/sql-editor/03_game_ux.sql` (new), the regenerated `supabase/sql-editor/00_all_migrations.sql` (`build.sh`), and additions to `supabase/sql-editor/90_tests.sql`;
- **additive** changes in `packages/core` (`PathStep` fields, the homonym helper) with tests. All existing tests must keep passing.

No other session is running. Don't commit.

## Changes requested by the owner

**Phrasing rule (applies to every change below):** questions are shown and spoken as the bare book label plus "?" ("ANCIEN ?", "LIE A ADAM ?", "Le meurtrier ?"). Remove every "Est-ce" from the app, including the TTS and the i18n strings. See GRAPH_SPECIFICATION §10.

### 1. The description appears only when the name is shared
- The Tireur's card shows the NAME, and **the description only when another person in the graph has the same name** (110 names in the real book, for example LEMEC, HENOC, JOAS; in `mini`, JACQUES).
- **Server:** `dsa_get_my_secret` returns `has_homonyms boolean`.
  - It's true when another CHARACTER node of the same graph, reachable through APPROVED edges, has the same `dsa_normalize(label)` and a **different `character_id`** (ABRAHAM and ABRAM are one person: not homonyms).
  - The return type changes, so `drop function` and then recreate it with its grants, in 0006.
- **Also:** `dsa_get_revealed_path().secret` gains `has_homonyms`, and the result screen applies the same rule.
- **Core:** `hasHomonyms(ix, nodeId)`, and the offline service mirrors the server.

### 2. The end-of-game path as a real graph, not a list
Build a `PathGraph` component (react-native-svg + react-native-gesture-handler + Reanimated, all included in Expo Go):
- **Layout** is a pure, tested function (`src/graph/path-layout.ts`) that turns the revealed path into positioned nodes and edges, like the book's mind maps:
  - a **spine step** (`prompt_kind = SPINE`): the question node, then an edge **down** labelled with the answer, into the section it entered (`target_text`, for example `LIE A DAVID`), drawn as a section box;
  - a **child prompt answered OUI**: the edge goes **down** into that child (the next prompts are its children);
  - a **child prompt answered NON**: the next sibling is placed **to the right** on the same row, joined by a NON edge. Long runs of NON wrap or scroll; they must stay readable at phone width.
  - The **final NAME** node has a star, and its description only if `has_homonyms`.
  - Only traversed and entered nodes are drawn; never unused branches (spec §6).
- **Style:**
  - answer tags use the book colours (OUI green, NON amber, OUIOUIOUI and NONONONON red, JE NE SAIS PAS blue), each with a text label so colour isn't the only signal;
  - node shapes differ for question, section, group (TOME, CLASSE) and name;
  - it must be legible in both themes.
- **Animation:** the camera follows each step as its edge draws (stroke-dashoffset) and its node appears, and the answer tag "stamps" in. Then it zooms out to fit the whole graph, and pinch or drag zoom and pan are enabled (mouse wheel and drag on the web). There's a **Rejouer l'animation** button. Respect reduced motion.
- **During play**, a **Voir le chemin** button opens the same graph without animation (traversed nodes only).
- **Server:** each `path[]` entry in `dsa_get_state` / `dsa_get_revealed_path` gains:
  - `prompt_kind` (`SPINE` | `CHILD`);
  - `node_type`;
  - `target_text` (for SPINE steps, the label of the node entered by the answer; null for CHILD).

  This only reveals what the answer already revealed, so there's no secret leak; extend the security test to check it.
- **Also add** `stats: {questions, non, backs, rewinds}` to `dsa_get_revealed_path` (S3 report §5.3), so the result screen stops counting on the client.
- **Core:** `PathStep` gains `targetText` and `nodeType`, and the offline service returns the same JSON.

### 3. A Découvreur view that can't be misread
Today the next question is shown above the answer to the previous one, so it reads as "SES ENFANTS ? → NON". Redesign it as a **conversation**:
- **Latest exchange as a pair:**
  - a Découvreur bubble "Tu as demandé : **LIE A ABRAHAM ?**";
  - a Tireur bubble "**NON**" in the answer colour (with the OUIOUIOUI/NONONONON mark when repeated);
  - after a name call: "Tu as proposé : ABSALOM" → "NON".
- **Then a clearly separate "À toi"** card: "**Question suivante** · **SES ENFANTS ?**" (direct book label, never "Est-ce …", see GAME_RULES "How questions are said") with the **Poser la question** button.
- **Waiting state:** after asking, the card shows "Le Tireur réfléchit…" with the question just asked. There's never a stale answer next to a new question.
- **Earlier exchanges** stay in a scrollable timeline above, older ones smaller or muted. The **Voir le chemin** graph (change 2) is one tap away.
- **Dead end:** "Plus de question dans cette liste" with **Revenir à une question** highlighted.

### 4. More engaging Tireur and Découvreur screens, ready for voice
- **Game table metaphor:** a header shows both seats (Tireur / Découvreur, with "IA" for the AI), a clear **turn indicator** ("À toi" / "Le Tireur réfléchit…" / "Le Découvreur réfléchit…"), and a question counter. Leave room in the header for a future countdown ring (§9), **but render nothing for it**.
- **Tireur:**
  - the secret is a physical-looking card (tap to flip it hidden or visible, with a flip animation);
  - the incoming question is big: "Le Découvreur demande : **LIE A ADAM ?**" (no "Est-ce");
  - the answer pad appears under it, showing only the classes allowed by `prompt.answer_classes`;
  - a name call is shown big: "Le Découvreur propose : **ABSALOM**" with OUI / NON;
  - the "QUESTION ×1/×2/×3" rewind is easy to find, but separated from the answers to prevent mis-taps.
- **Feedback:** the answer "stamps" in when it arrives (scale plus colour), with haptics on native, and a short, subtle success animation on discovery.
- **Game setup screen** ("Préparer la partie") before every game:
  - role and mode, as today;
  - **Façon de jouer: Voix / Boutons**. "Voix" is shown and selectable in the UI but disabled, marked "Bientôt", until S7. Store the choice in `game_sessions.settings.input_mode`: add `settings jsonb not null default '{}'` in 0006, and `p_settings jsonb default '{}'` to `dsa_create_session`, which means dropping and recreating it with its grants.
  - The **room creator** will choose this for both players (S6); for solo and LOCAL it's the player's choice.
  - Unknown keys in `p_settings` are rejected; `input_mode` ∈ `VOICE|BUTTONS`, default `BUTTONS`.
- Use the `frontend-design` skill. Keep the S3 identity (chalkboard and brass, Zilla Slab) unless a change clearly helps. Touch targets ≥56 pt.

### 5. LOCAL ("Deux joueurs sur ce téléphone") starts with the Tireur
- First screen after creation: "Passe le téléphone au **Tireur**" → the Tireur views the card → "C'est bon, je suis prêt" → "Passe le téléphone au **Découvreur**" → the first question.
- This is a client-side phase for now (the §9 timer will later make it a server phase; keep it as one clearly named step, `TIREUR_READY`, in the hook so that change is easy).

## SQL delivery (no Docker)
- `0006_game_ux.sql`: only the changes above, re-runnable (`drop function if exists … ; create …`, `add column if not exists`, grants re-applied).
- `sql-editor/03_game_ux.sql`: the same content, for the owner to paste into an **existing** project that already ran 00 and 01. Regenerate `00_all_migrations.sql` with `build.sh`, for fresh projects.
- Extend `90_tests.sql`:
  - `has_homonyms` is true for JACQUES and false for CAÏN, and false for ABRAM/ABRAHAM (same person);
  - the new path fields for scenarios 1 and 4 (`target_text` `LIE A DAVID` after OUIOUIOUI);
  - stats, settings validation, `input_mode` default;
  - no secret leak in the new fields.
- Verify it as S2 did: `libpg-query` for syntax and `@electric-sql/pglite` for execution, both installed in **your scratchpad, not the repo**. Run `00 → 01 → 90` on a fresh database, **and** `00(old) → 01 → 03 → 90` to simulate the owner's upgrade path. Update `DATABASE_SCHEMA.md` (you may edit it for these additions) and `supabase/sql-editor/README.md`.

## Tests and verification (paste the output in the report)
- `npm test` and `npm run typecheck` for `packages/core` and `apps/mobile`;
- unit tests for `path-layout.ts`: a spine step goes down with `target_text`, NON goes right, OUI on a child goes down, a long NON run wraps, the name node comes last, no node for untraversed branches;
- a render test: the description is hidden when `has_homonyms` is false and shown when it's true (Tireur card and result);
- a render test: the Découvreur view pairs each question with its own answer, and never shows an answer next to a question it doesn't belong to;
- the LOCAL flow starts with the Tireur;
- `npx expo-doctor`, and `npx expo export -p web --clear`;
- headless-browser screenshots (offline mode) into `docs/sessions/reports/S3b-screens/`: setup screen, LOCAL Tireur-first, Découvreur conversation (asked, waiting, answered, dead end), Tireur answering and a name call, the path graph mid-animation and fully zoomed out, at 390 px and 1280 px, light and dark.

## Report
Write `docs/sessions/reports/S3b-game-ux.md` with:
- the files, outputs and screenshots;
- **the exact SQL file the owner must paste**, and what to expect;
- deviations and open questions;
- notes for S6 (rooms: `settings.input_mode` chosen by the creator) and S7 (voice: where the "Voix" choice plugs in).
