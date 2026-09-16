# Report S1: `packages/core`

Status: **done**. All 158 tests pass and the typecheck is clean. Nothing was committed.

## Result lines

```
$ npm test --workspace packages/core
 Test Files  9 passed (9)
      Tests  158 passed (158)

$ npm run typecheck --workspace packages/core
> tsc --noEmit            (exit 0, no output)

$ npm run fixtures --workspace packages/core
✓ 7 pages → 30 nodes, 29 edges, 12 characters
✓ 0 build errors
✓ 0 build warnings
✓ valid (0 errors, 1 warnings)      # JACQUES shared by 2 characters (expected)
```

## Real book (`data/book`, 53 page files at the time of the run)

`buildGraphData('livre', …)` with the default `NEEDS_REVIEW`:

```
✓ 53 pages → 1647 nodes, 1646 edges, 1157 characters
✓ 0 build errors
✓ 0 build warnings
✓ 1647 nodes (START 1, QUESTION 14, CATEGORY 285, GROUP 138, CHARACTER 1209)
✓ 1646 edges
✓ 1157 characters
⚠ 0 playable characters
⚠ 1647 nodes and 1646 edges NEEDS_REVIEW
WARNING: [SHARED_CHARACTER_LABEL] name "LEMEC" is shared by 2 characters: Premier polygame · Lié à CAIN | Père de NOE · Lié à SETH
WARNING: [SHARED_CHARACTER_LABEL] name "HENOC" is shared by 2 characters: Marcha avec DIEU · Lié à SETH | 5eme · LIE A MADIAN
WARNING: [SHARED_CHARACTER_LABEL] name "ASSUR" is shared by 2 characters: 1er · SES FILS | Battit Ninive · LIE A CHAM
WARNING: [SHARED_CHARACTER_LABEL] … and 107 more
✓ valid (0 errors, 110 warnings)
```

I also ran a one-off check, not a test, that rebuilds with `defaultReviewStatus: 'APPROVED'`:
- **Playable characters:** 1184 of 1209. The rest sit under the two nodes the lead tagged `{review}`:
  - `…/lie-a-abraham/tome-3` (O1);
  - `ancien[oui]/homme[ouioui]/livres-prophetiques/livre-poetique` (R6a).
- **Structural errors:** 0.

## Parsing problems in `data/book`

**None.** Across the spine and all 53 page files there were no parse errors, no unresolved `@attach`, no key collisions and no empty categories. The 110 shared-name warnings are expected (DIGITIZATION_REPORT §7) and aren't errors.

## Files

```
packages/core/package.json            @dsa/core; deps: uuid; devDeps: typescript, vitest, tsx
packages/core/tsconfig.json           strict, noUncheckedIndexedAccess, lib ES2022 only (no DOM), types: []
packages/core/src/index.ts            public exports
packages/core/src/types.ts            spec §4 types + PathStep, GameStats, ValidationReport, Parsed*, BuildReport, EngineMove
packages/core/src/normalize.ts        stripAccents, normalizeText, normalizeName, tokenize
packages/core/src/keys.ts             slugify, answerSlug, key builders, nodeId/edgeId/graphId/characterId (UUID v5)
packages/core/src/answers.ts          answerClass, allowedClassesFor, sameAnswer
packages/core/src/graph-index.ts      GraphIndex
packages/core/src/rules.ts            derivePosition, currentPrompt, correctAnswer, isCorrectName (+ helpers)
packages/core/src/errors.ts           EngineError + codes
packages/core/src/engine.ts           GameEngine
packages/core/src/intents.ts          matchIntent, INTENT_THRESHOLDS, jaroWinkler, phoneticKey
packages/core/src/validator.ts        validateGraph, formatReport
packages/core/src/book-parser.ts      parseSpine, parsePage, buildGraphData, formatBuildReport
packages/core/scripts/load-book.ts    Node-only: read .dsa dirs from disk (tests + scripts)
packages/core/scripts/build-mini-fixture.ts   `npm run fixtures`
packages/core/types/node-shim.d.ts    minimal node:fs/path/url typings for tests and scripts
packages/core/fixtures/mini/spine.dsa, fixtures/mini/pages/p008,p011,p023,p034,p041,p053,p068.dsa
packages/core/fixtures/mini-graph.json   generated (GraphData, 2-space JSON)
packages/core/test/{fixture,basics,rules,engine,intents,validator,parser,real-book,purity}.test.ts, helpers.ts
package-lock.json                     root
```

What the tests cover:
- **Mini fixture:** the fixture is checked row by row against every table in `mini-graph-fixture.md`, including `source_variants`, and against the committed JSON.
- **Scenarios:** 1–11 each have an engine test.
- **Keys:** exact UUIDs, cross-checked with Python `uuid.uuid5`.
- **Intents:** 68 utterances.
- **Validator:** one test per error class.
- **Parser:** tags, alias, `same-as`, attach across pages, collisions and error line numbers.
- **Purity:** `src/` imports only `uuid` and relative files, and uses no `process`, `window`, `console` or `any`.

## Deviations from spec §4, and interpretations

**S2 must match the first two items**, otherwise the TS and SQL graphs will differ:

1. **`order_index` is 0-based**, per parent, in book order. The spec doesn't give a base.
2. **Graph and character IDs.** The spec doesn't define them:
   - `graph.id = uuidv5(slug)`;
   - `character.id = uuidv5(graphSlug + ':character:' + primaryNodeKey)`;
   - the primary node is the first alias child, or the `{same-as}` target.
3. **Character descriptions:**
   - `"<clue> · <nearest CATEGORY>"`; GROUP ancestors (CLASSE, TOME, ALIAS) are skipped, so CAÏN gets `Le meurtrier · LIE A ADAM`.
   - For an ALIAS group the clue is the group label, so ABRAHAM/ABRAM get `PÈRE DE LA FOI · LIE A ABRAHAM`, because "plus connu" isn't a clue.
   - `node.description` is set to the character's description.
   - `nameFr` = the name; `nameEn`, `gender` and `testament` are null.
4. **Engine states:**
   - **`guess`:** only while `awaiting = QUESTION`, which includes dead ends and a reached CHARACTER. Guessing between `ask` and `answer` throws `NOT_AWAITING_QUESTION`. Otherwise the state would need an extra field to know where to return after a NON.
   - **`goBack` and `rewind`:** allowed while awaiting QUESTION or ANSWER (a pending question is dropped), and rejected during GUESS_CONFIRM.
   - **Error codes:** a bad `goBack` index throws `INVALID_STEP`; a bad rewind count throws `INVALID_REWIND`.
   - **`confirmGuess`:** accepts any label whose class is OUI or NON.
5. **`aiDecouvreurAction` at a dead end.** Taken literally ("most recent NON"), it would pick the last child's NON and re-ask the same exhausted list forever. Instead:
   - it skips NON answers given inside the exhausted list and goes back to the most recent NON before that, which is exactly scenario 9's expected `goBack(2)`;
   - it falls back to the literal rule only if nothing else exists;
   - after its own name call at a leaf is refused (only possible with a human Tireur), it goes BACK to the last step instead of guessing again.
6. **`correctAnswer` off the secret's path.** This can only happen after a wrong human answer, when no branch contains the secret. It returns `NON` if allowed, otherwise the last allowed class. `correctAnswerLabel` returns the canonical edge label, which is what `aiTireurAnswer` uses.
7. **`EngineMove` shape:**
   - it is a discriminated union;
   - the `ANSWER` move stores `expectedClass`, the truthful class, which feeds `stats.wrongAnswers`. **This is derived from the secret**, so never send `moves` to a Découvreur client as-is;
   - the `SYSTEM` start move stores `secretNodeId`.
8. **`PathStep` and `GameStats`:**
   - `PathStep` is `{kind:'STEP', index, promptNodeId, promptKind, text, answerLabel, answerClass}` or `{kind:'NAME', nodeId, name, description}`;
   - `GameStats` = questions, answers, nonAnswers (class NON only), wrongAnswers, guesses, wrongGuesses, rewinds, backs, durationMs.
9. **`GraphIndex` API:**
   - `node(id)` returns `undefined` when the node is missing;
   - added `nodeByKey`, `requireNode`, `nodes`, `incomingEdges`;
   - `playableCharacters()` returns characters in book order (depth-first by `orderIndex`).
10. **Additive exports:**
    - rules: `startPosition`, `answerLabelsFor`, `isAnswerAllowed`, `applyAnswer`, `replaySteps`, `isDeadEnd`, `correctDecisionEdge`, `correctAnswerLabel`;
    - engine: `GameEngine.prompt/position/isDeadEnd/abandon`;
    - other: `textSimilarity`, `formatBuildReport`, `IntentContext`.
11. **`answerClass` rules:**
    - letters are compared with accents and non-letters removed;
    - NON_REPETE counts *overlapping* `NON` occurrences, so `NONONO` qualifies (scenario 4);
    - `NONO` is AUTRE.
    - Two AUTRE labels (for example `CODE INCONNU (JOB)`) are different answers when their letters differ, both for matching and for the duplicate-class check.
12. **`buildGraphData` options:**
    - `opts` also takes `graphName`, `graphStatus` (default `DRAFT`) and `sourceDocument`; the mini fixture uses `PUBLISHED`;
    - page-tree HIERARCHY edges inherit their child node's review status and note, so a `{review}` node is unreachable when playing approved-only;
    - in the spine, tags before `->` belong to the edge and tags after it belong to the node.
13. **Transcription format additions to §5:**
    - several `@attach` sections per page are allowed;
    - `{group}` / `{group: KIND}` are accepted;
    - **unknown tags and unknown `@directives` are parse errors**;
    - a `•` clue with nothing before it gives `question = null`;
    - `{same-as}` stores `metadata.same_as`, and a different label is added to the shared character's aliases.
14. **Validator additions:**
    - `CHARACTER_ID_UNKNOWN`;
    - START edges must be SYSTEM;
    - `MULTIPLE_PARENTS` warning;
    - END nodes are exempt from `NO_OUTGOING`;
    - `SHARED_CHARACTER_LABEL` ignores nodes that share one character (alias, same-as).
15. **`normalizeName`** also ignores apostrophes, not just hyphens and spaces.
16. **Node typings.** There is no `@types/node` (the brief allows only three dev dependencies), so tests and scripts use `types/node-shim.d.ts`. `src/` stays free of Node APIs, and the purity test enforces this.

## Intent matcher notes

- **Thresholds** are exported as `INTENT_THRESHOLDS`: ask 0.75, guess 0.88, back 0.7, token 0.85, askOverGuess 0.08, guessAmbiguity 0.03, shortNameLength 3.
- **Role gating:** TIREUR → REWIND or ANSWER only; DECOUVREUR → BACK, ASK or GUESS only.
- **ASK scoring:** fuzzy Dice token overlap after removing scaffolding and mapping ordinals/cardinals to digits ("première classe" = "CLASSE 1", "tome un" = "TOME 1"). If the numbers differ, the score is capped at 0.4, so "classe 2" never matches "CLASSE 1".
- **GUESS scoring:**
  - Jaro-Winkler on n-grams, plus a simple French phonetic key ("Kaïn" → CAÏN);
  - a phonetic-only match is capped at 0.95, so "Abram" picks ABRAM, not ABRAHAM;
  - names of 3 letters or fewer (ON, DAN, OG…) must be the whole utterance;
  - two different names within 0.03 of each other → UNKNOWN.
- **"ben" isn't a filler word**, because it starts names like BEN-AMMI.

## Open questions

1. **`order_index` base and graph/character UUID names** (deviations 1–2) should be confirmed with S2 and written into the spec.
2. **Name call between `ask` and `answer`:** should it be allowed? It is currently rejected.
3. **REFERENCE nodes:** §5 defines no syntax for them. The parser never creates them, and the validator reports any that exist.
4. **Two review tags in the book** keep subtrees unplayable: `tome-3` (O1) and `livre-poetique` (R6a, now under LIVRES PROPHETIQUES "by analogy").
5. **Security:** `EngineState.moves` and `secretNodeId` reveal the secret (deviation 7). Wave-2 clients must only build Découvreur views from `prompt` and `revealedPath` before the game ends.
6. **npm audit** reports 2 moderate vulnerabilities in dev dependencies (the vitest/vite toolchain). I haven't investigated them, and I didn't run `npm audit fix --force`.
