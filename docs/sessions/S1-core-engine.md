# Brief S1 — `packages/core` (types, rules, game engine, intents, validator, book parser)

You are a senior TypeScript engineer on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game played by voice between a Tireur and a Découvreur. Repo: `/home/winner/projects/DSA` (npm workspaces; Node 22, npm 10).

## Read first, completely
1. `docs/sessions/README.md` (global rules: **no Docker**, no git commit, stay in your folders)
2. `GAME_RULES.md`: the rules, as confirmed by the owner
3. `GRAPH_SPECIFICATION.md`: the contract, especially §2 (model and traversal rules), §4 (public API) and §5 (transcription format)
4. `docs/sessions/mini-graph-fixture.md`: the fixture and the scenarios your tests must implement
5. `DIGITIZATION_REPORT.md` §3 and §9 (background)
6. `data/book/spine.dsa` and `data/book/pages/*.dsa`: real transcription files (read-only for you). The lead keeps adding pages while you work.

## You own
`packages/core/**` and the root `package-lock.json` (you are the only wave-1 session that runs `npm install`). Don't touch anything else. If the spec is wrong or incomplete, don't edit it; write your proposal in the report.

## Deliver
A pure TypeScript package, `@dsa/core`:
- no React, React Native, DOM or Node runtime APIs, so it works in Expo/Metro, Next.js and tsx;
- `package.json` with `"main": "src/index.ts"` and `"types": "src/index.ts"`;
- strict TypeScript, and no `any` in graph or game structures;
- runtime dependency: `uuid` only; dev dependencies: `typescript`, `vitest`, `tsx`;
- scripts: `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `fixtures` (regenerates `fixtures/mini-graph.json` from `fixtures/mini/*.dsa`).

Modules, one concern per file, exported from `src/index.ts`:
1. `types.ts`: everything in spec §4, plus `PathStep`, `GameStats`, `ValidationReport`, `ParsedSpine`, `ParsedPage`, `BuildReport` and `EngineMove`.
2. `normalize.ts`: French text normalization shared by everything: lowercase, strip accents (including ï, ë, œ→oe, æ→ae), unify apostrophes (’ '), and collapse punctuation and whitespace. `normalizeName()` also ignores hyphens and spaces.
3. `keys.ts`: `slugify`, `answerSlug`, node and edge key construction, and `nodeId` / `edgeId` as UUID v5 (spec §2).
4. `answers.ts`: `answerClass(label)` (repetition count is never significant), and `allowedClassesFor(prompt)`.
5. `graph-index.ts`: `GraphIndex`, with children sorted by `orderIndex` and `approvedOnly` defaulting to true.
6. `rules.ts`: `derivePosition`, `currentPrompt`, `correctAnswer`, `isCorrectName`. This is **the single place the rules live**; implement spec §2 exactly. Child prompt text is the child's label, or its `question` (clue) for a CHARACTER child. TOME and CLASSE are ordinary questions. There is no alphabetical logic anywhere.
7. `engine.ts`: `GameEngine` with immutable transitions (spec §4). Typed `EngineError` codes:
   - `NOT_AWAITING_QUESTION`, `NOT_AWAITING_ANSWER`, `NO_PROMPT`, `ANSWER_NOT_ALLOWED`;
   - `NOT_AWAITING_GUESS_CONFIRM`, `INVALID_STEP`, `INVALID_REWIND`, `GAME_OVER`.
   
   `goBack` and `rewind` move the removed steps to `undoneSteps`. `revealedPath` returns only the steps that weren't undone, plus the discovered name.
   - `aiDecouvreurAction`: if the current node is a CHARACTER, GUESS its label; if there's a prompt, ASK; on a dead end, BACK to the most recent step whose answer was NON.
   - `aiTireurAnswer`: for an ANSWER, the canonical label of `correctAnswer`; for a GUESS_CONFIRM, `isCorrectName`.
   
   `stats`: number of questions, number of NON answers, rewinds, backs, duration.
8. `intents.ts`: `matchIntent(utterance, ctx)`, spec §4. French, deterministic, no LLM.
   - **ANSWER:**
     - "oui", "ouais", "exact", "c'est ça", "tout à fait" → OUI;
     - "non", "nan", "pas du tout" → NON;
     - OUI said ≥2 times (for example "oui oui", "ouioui", "oui oui oui oui") → the ctx label whose class is OUI_REPETE, and the same for NON;
     - "je ne sais pas", "je sais pas", "chais pas" → JE NE SAIS PAS.
     - A single "oui" must **never** map to a repeated label.
     - Only labels present in `ctx.answerLabels` are returned.
   - **REWIND (Tireur):** the word "question" said 1–3 times.
   - **BACK (Découvreur):** "retour", "revenir", "reviens", "question précédente", "on revient à …" (fuzzy-match the rest against `ctx.path` texts to pick the stepIndex).
   - **ASK:** the utterance matches the current prompt text after stripping question scaffolding ("est-ce que", "est-ce", "c'est", "est-il", "est-elle", "il s'agit de", "dans le/la/les", "du", "de la", "le/la/les", "?" …). Ordinal and class synonyms: "premier/1er", "deuxième/second/2ème/2eme", "première classe/1ère classe/classe 1", "tome un/tome 1". Use token overlap plus a hand-written Jaro-Winkler or Levenshtein score. Export the thresholds.
   - **GUESS (Découvreur):** the utterance contains a fuzzy match of one of `ctx.knownNames`, optionally wrapped in "c'est", "est-ce", "je pense que c'est", "!". When both ASK and GUESS are plausible, prefer ASK only if its score is clearly higher. If the result is ambiguous or below threshold → UNKNOWN.
9. `validator.ts`: `validateGraph` plus `formatReport()` (plain text like `✓ 842 nodes` / `ERROR: …`). Checks:
   - edges pointing to nodes that don't exist;
   - START count ≠ 1;
   - non-CHARACTER nodes with no outgoing edge;
   - QUESTION nodes with edges that aren't DECISION, and CATEGORY/GROUP nodes with edges that aren't HIERARCHY;
   - CHARACTER nodes with no `characterId`, or with outgoing edges;
   - duplicate edges, and duplicate `(from, orderIndex)`;
   - two DECISION edges from the same node with the same answer class;
   - orphan nodes, nodes unreachable from START, and cycles;
   - unresolved REFERENCE nodes;
   - counts of NEEDS_REVIEW nodes and edges, and the number of playable characters;
   - a warning listing CHARACTER labels shared by several nodes, with their generated descriptions.
10. `book-parser.ts`: `parseSpine`, `parsePage`, `buildGraphData` (spec §5).
    - Multiple tags per line; labels may contain parentheses, commas and apostrophes; `@pNN` lists; `•`, `·` or ` * ` as the character separator.
    - Error messages include file and line number.
    - `buildGraphData`:
      - resolves `@attach` against spine keys and page keys (a node may get children from several pages; order = page number, then line order);
      - handles `{key}`, `{same-as}`, and ALIAS groups whose children share one character (first child's label is the name, the others go to aliases);
      - generates character descriptions `"<clue> · <nearest CATEGORY label>"`;
      - sets `review_status` from `{review}` (with the note), or `defaultReviewStatus` otherwise (default `NEEDS_REVIEW`);
      - stores variants, notes, `printed_page` and `extra_pages` in metadata, with gender and testament left null;
      - reports unresolved attaches, duplicate keys and empty categories.
11. `fixtures/mini/spine.dsa` and `fixtures/mini/pages/*.dsa`, written so that `buildGraphData('mini', …, {defaultReviewStatus: 'APPROVED'})` produces **exactly** the node keys, labels, questions, edge kinds, labels and order in `docs/sessions/mini-graph-fixture.md`. Use `{key: …}` where needed, and put `NONONONO@27` into `source_variants`. Commit the generated `fixtures/mini-graph.json`.

## Tests (Vitest), all must pass
- Every scenario in `mini-graph-fixture.md` (1–11) as an engine test.
- Unit tests for `normalize`, `keys` (determinism and the exact UUIDs of a few mini keys), `answerClass`, `rules` (prompt text, dead end, TOME prompt) and `intents`: at least 40 French utterances covering ANSWER, REWIND, BACK, ASK, GUESS and UNKNOWN. Include "Est-ce que c'est dans le Pentateuque ?", "C'est un homme ?", "Le meurtrier ?", "Caïn !", "première classe ?", "Tome un ?", "question question", "oui oui", "oui", and noise like "euh attends".
- A validator test for each error class, using small broken graphs.
- Parser tests: tags, alias, same-as, attach across pages, collisions, error line numbers.
- **Real book test:** parse `data/book/spine.dsa` and every `data/book/pages/*.dsa`, run `buildGraphData('livre', …)`, and assert there are no parse errors and no unresolved attaches **for the pages that exist**. Print the `formatReport` summary, but don't fail on NEEDS_REVIEW or on the missing section children that later pages will fill in.

Run `npm install` at the repo root, then make `npm test --workspace packages/core` and `npm run typecheck --workspace packages/core` both pass.

## Report
Write `docs/sessions/reports/S1-core.md` with:
- the file list;
- the exact test and typecheck output summary lines;
- the real-book `formatReport` summary;
- any API deviations from spec §4, with reasons;
- parsing problems found in `data/book` (file:line), since the lead fixes those files;
- open questions.
