# Report S5b: the "Homonymes" page

Status: **done.** The route `/graphes/[slug]/homonymes` is built and linked from the graphs list, the editor header and the review page. Typecheck is clean, 87 admin tests pass (43 new), the production build succeeds, and the page was driven in a headless browser in mock mode with no console, page or server errors. Nothing was committed. As in S5, it hasn't been run against a real Supabase project; it saves through the S5 diff and repository, unchanged.

**Incident to know about (§6):** during the screenshot run I deleted `apps/admin/.next` while the owner's own `npm run admin` (port 3000) was using it, and that dev server has since exited. **Restart `npm run admin`** (deleting `apps/admin/.next` first if it misbehaves).

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
 ✓ test/homonyms.test.ts (43 tests)
 Test Files  8 passed (8)
      Tests  87 passed (87)

$ npm run build --workspace apps/admin
 ▲ Next.js 15.5.25
 ✓ Compiled successfully in 12.5s
Route (app)                                 Size  First Load JS
┌ ○ /                                      122 B         103 kB
├ ƒ /connexion                           1.24 kB         175 kB
├ ƒ /graphes                             1.36 kB         107 kB
├ ƒ /graphes/[slug]                        83 kB         270 kB
├ ƒ /graphes/[slug]/homonymes            6.66 kB         193 kB
├ ƒ /graphes/[slug]/revue                4.94 kB         111 kB
└ ○ /icon.svg
exit 0

$ npm run typecheck            (root, every workspace: core, voice, admin, mobile, scripts)
exit 0

$ npm test                     (root)
@dsa/core     Tests  170 passed (170)
@dsa/voice    Tests  165 passed (165)
@dsa/admin    Tests   87 passed (87)
@dsa/mobile   Tests: 158 passed, 158 total
@dsa/scripts  Tests   64 passed (64)
exit 0
```

My first root typecheck failed in `apps/mobile/tests/voice-play.test.tsx` (`TS1128`). That file is untracked and was modified at 09:44:25, during the run, by the session working on the mobile app. The re-run above is clean. It isn't an admin issue.

### What the new tests cover (`test/homonyms.test.ts`)

| Brief item | Tests |
|---|---|
| Grouping | The two JACQUES of the mini graph form one group of two people, with the right book path. A second leaf of **the same character** doesn't create a group (aliases excluded), and stays attached to its person as `otherNodes`. Names are compared with `normalizeName` (`Ca-in` groups with `CAÏN`). A leaf without a character counts as its own person. The card description is read from the character first, like `dsa_get_my_secret`. |
| Weak-description detector | 20 generic clues (`1er`, `2ème`, `Le 1er`, `LE PREMIER`, `L'aîné`, `2ème fils`, `Son père`, `SES FILS`, `plus connu`, `moin connu`, `autre`, empty…). 7 clues that must stay meaningful (`Premier homme`, `Le meurtrier`, `Fils d'Alphée`, `Serviteur de MOÏSE`, `Le 1er roi`…). Whole descriptions (`1er · SES FILS` weak; `1er · SES PETITS FILS · LIE A SEM` strong). The filter. |
| Identical-description detector | Ignores case, accents and punctuation; two empty descriptions count as identical; both JACQUES are flagged once they match; the filter and the search. |
| Suggestion builder | `clue · parent · grandparent`; GROUP ancestors (CLASSE, TOME) and START are skipped; the ALIAS group label is used as the clue instead of the qualifier; the brief's example shape `1er · SES PETITS FILS · LIE A …`. |
| Diff produced by an edit | `setCardDescription` gives exactly one character update and one node update, both with `changed = ['description', 'metadata']`, `description_edited: true`, the same text on both, and no edge changes. Every leaf of the same person is kept in sync; typing is one undo step; an emptied field is stored as `null`. |

**Mutation check.** I broke four rules on purpose, and 8 of the 43 tests failed; the code was then restored:
- grouping by node instead of by character;
- the identical detector never matching;
- the store not setting `description_edited`;
- the "plus connu" pattern removed.

### On the real book (built in memory from `data/book`; a scratch script printed counts only, then was deleted)

```
graph 1647 nodes; findHomonyms 19.2 ms
names 110, people 236, weak 101, identical 0, edited 0; largest group 4 people
236 suggestions in 3.8 ms; still weak after suggestion: 0; groups whose suggestions still collide: 0
```

So **101 of the 236 descriptions are weak**. Accepting "Suggérer" would make all of them strong, and no two people of the same name would end up with the same suggestion. This is the transcription's state, not the database's; after admin edits, the page reads the database.

## 2. Screenshots (`docs/sessions/reports/S5b-screens/`)

> **The images were deleted on 2026-09-23.** The table below *is* the record. Don't re-capture these screens to find out what they showed — read the words. If you need a picture of something this table doesn't answer, capture only that one screen with `tools/screens/`, write down what it told you, and delete it again.


Taken in mock mode (`NEXT_PUBLIC_DSA_MOCK=1`, the mini graph), driven by Playwright with the system Chrome at 1440×900; the tablet shots are 1024×768.

| File | Shows |
|---|---|
| `01-homonymes.png` | The page: counters, filters, JACQUES × 2 with their card previews |
| `02-description-faible.png` | First JACQUES edited to `1er · LES EVANGILES`: the card updates live, badges "Faible" and "Non enregistrée", counters move |
| `03-descriptions-identiques.png` | Both set to the same text: "Identique" on both, and the red "Descriptions identiques" warning on the group |
| `04-enregistrer.png` | Save dialog: "2 nœuds modifiés • 2 personnages modifiés" |
| `05-filtre-identiques.png` | After saving, the "Identiques" filter |
| `06-suggestions-theme-clair.png` | "Suggérer" on both, with the light-theme preview |
| `07-filtre-deja-modifiees.png` | After the second save, the "Déjà modifiées" filter |
| `08-editeur-lien-homonymes.png` | "Ouvrir dans l'éditeur": the JACQUES node selected, with its synced description and the new "Revue" / "Homonymes" header links |
| `09-tablette-homonymes.png`, `10-tablette-editeur.png` | 1024×768 (a reload, so mock edits from the browser are gone, see deviation 10) |

What the script checked along the way:
- the list page has a "Homonymes" link, and so do the review page and the editor header;
- the card preview uses Zilla Slab and reads "Ta carte / JACQUES / 1er · LES EVANGILES / Cacher";
- Ctrl+Z and Ctrl+Shift+Z undo and redo a whole typed description;
- clicking "Éditeur" with unsaved edits asks "4 modifications non enregistrées seront perdues. Quitter cette page ?", and dismissing stays on the page;
- saving shows "Enregistré : 2 nœuds modifiés, 2 personnages modifiés.";
- filter counts go from `Tous 1 / Descriptions faibles 0 / Déjà modifiées 0 / Identiques 0` to `1 / 1 / 1 / 1` after the first save, then `1 / 0 / 1 / 0` after the suggestions are saved;
- "Descriptions faibles" then shows its empty state;
- "Ouvrir dans l'éditeur" opens `?noeud=<the JACQUES node>`.

## 3. Files

```
NEW   src/lib/homonyms.ts                          findHomonyms, homonymStats, filterHomonyms, GENERIC_CLUE_PATTERNS,
                                                   isGenericClue, isWeakDescription, identicalKeys, suggestDescription (pure)
NEW   src/components/homonyms/homonym-board.tsx    the page: counters, filters, search, groups, per-person column, save
NEW   src/components/homonyms/tireur-card-preview.tsx   the Tireur's card, face up, as apps/mobile draws it
NEW   src/components/guarded-link.tsx              GuardedLink (asks before leaving with unsaved edits), useUnsavedCount
NEW   src/app/graphes/[slug]/homonymes/page.tsx    route
NEW   test/homonyms.test.ts                        43 tests
EDIT  src/store/editor-store.ts                    setCardDescription(nodeId, text, mergeKey)
EDIT  src/components/editor/node-inspector.tsx     one "Description (carte du Tireur)" field, through setCardDescription
EDIT  src/components/editor/graph-editor.tsx       header links "Revue" and "Homonymes"; back arrow is a GuardedLink
EDIT  src/components/review/review-board.tsx       header link "Homonymes"
EDIT  src/app/graphes/page.tsx                     "Homonymes" button per graph
EDIT  next.config.ts                               distDir from DSA_ADMIN_DIST_DIR (default .next), see §6
```

`apps/admin/next-env.d.ts` shows a one-line diff (`/// <reference path="./.next/types/routes.d.ts" />`). `next build` writes that line on every build; it was already there after S5.

## 4. How the page works

- **Who is listed.** CHARACTER nodes are grouped by `normalizeName(label)`. A person is a `characterId`, or the node itself when it has no character. A name is listed when it has 2+ people. For each person, the first leaf in book order is shown, and further leaves of the same person are listed as "aussi p. N".
- **Card description.** It's `character.description ?? node.description`, exactly what `dsa_get_my_secret` returns. The preview always shows it, because on this page every name is shared, which is exactly when the app shows it (GRAPH_SPECIFICATION §8).
- **Card preview.** It copies `apps/mobile/src/components/secret-card.tsx`, face up:
  - "Ta carte" at 15 px, soft;
  - the NAME bold at the `fitVariant` size (46/34/26 px, with the same letter-spacing);
  - the description at 17 px, soft;
  - "Cacher" at 13 px, faint, bottom right;
  - Zilla Slab, the app's palettes (dark by default, like the app; a "thème clair" toggle), the 20 px outer and 14 px inner radii, the 5 px bottom edge, and a 350 px width (a 390 pt phone minus padding).
- **Per person:**
  - review status badge, plus flags "Faible", "Identique", "Modifiée", "Non enregistrée" and "Sans personnage";
  - the description field (serif);
  - "Suggérer", with the suggestion shown in grey next to it;
  - the book path breadcrumb (root › … › `clue • NAME`);
  - "Source : page N";
  - "Ouvrir dans l'éditeur" → `/graphes/[slug]?noeud=<node id>`, which opens the editor focused on the node's parent with the node selected (S5).
- **Saving.** Edits go into the S5 editor store (so undo/redo works), and "Enregistrer" opens the S5 `SaveDialog` with the S5 diff; the repository is unchanged. Each keystroke in a field calls `setCardDescription`, which:
  - sets `bible_characters.description` **and** `metadata.description_edited = true` on the character;
  - mirrors the text, with the same flag, on every CHARACTER node of that character (IMPORT_GUIDE §8 and the S4 report §4.7: the importer keeps flagged descriptions);
  - does all of it as one merged undo step per field.
- **Counters** (live, from the draft): noms partagés, personnes, descriptions faibles ou identiques, déjà modifiées.
- **Filters** (Tous / Descriptions faibles / Déjà modifiées / Identiques) and the name search are computed from the **saved** graph, so a row doesn't vanish while you are fixing it; the page says so under the header.

## 5. Deviations and interpretations

1. **All leaves count, not only playable ones.** The game's `hasHomonyms` counts only playable leaves (approved and reachable). The admin lists every CHARACTER leaf, so descriptions can be fixed before approval. A name listed here may therefore not show its description in the game yet, if one of the people isn't approved.
2. **"Weak" is judged on the current description, not only on the clue.** A description is weak if:
   - it is empty;
   - every segment is generic;
   - or it has the generated shape `<generic clue> · <one section>`.

   Once a second section is added (as "Suggérer" does), it's no longer weak, even though the clue is still "1er". All the patterns are in `GENERIC_CLUE_PATTERNS` in `src/lib/homonyms.ts`:
   - ordinals and ranks (`1er`, `2ème`, `le dernier`, `l'aîné`, `cadet`…), optionally followed by a kinship word;
   - article or possessive + kinship (`son père`, `ses fils`…);
   - `plus / moins / moin connu`;
   - placeholders (`autre`, `idem`…).

   A rank followed by a non-kinship word (`Premier homme`, `Le 1er roi`) is deliberately **not** generic.
3. **Identical includes empty:** two people of the same name with no description are "identiques" (and both weak): the Tireur can't tell them apart either.
4. **Suggestion path rule:** `clue · nearest ancestor · next ancestor`:
   - skips GROUP (CLASSE, TOME, ALIAS) and START, like the importer's description rule (§7);
   - **keeps spine QUESTION labels** when fewer than two categories are above, so a JACQUES gets `Fils d'Alphée · LES EVANGILES · HOMME`;
   - under an ALIAS group, the group label is the clue, because the leaf's "question" there is only the qualifier (`plus connu`);
   - duplicate segments are dropped;
   - nothing is saved until "Enregistrer".
5. **One description field in the editor too.** The S5 node panel had two fields (the node's description and the character's) that could drift apart. It now has one, "Description (carte du Tireur)", which shows `character ?? node` and writes through the same `setCardDescription`. The alias list stays in the character block.
6. **"Modifiée" follows the draft.** The flag is set as soon as you type, so "Modifiée" (and the "déjà modifiées" counter) appears before saving, next to "Non enregistrée". The "Déjà modifiées" filter uses the saved flag.
7. **Leaving with unsaved edits now asks first.** In S5, only reloads were guarded; client-side links in the editor dropped the draft silently. `GuardedLink` asks first and is used on the Homonymes page and in the editor header.
8. **Keyboard:** Ctrl+Z / Ctrl+Shift+Z on this page drive the store's undo, like the editor (also inside a text field; a typed description is one step).
9. **Tablet:** the header wraps to two rows at 1024 px, and each person column needs 408 px, so groups show two people per row.
10. **Mock mode** is as in S5: the page loads and saves in the browser, so a reload returns to the fixture.

## 6. Environment notes

- **The owner's dev server.** Before the screenshot run I deleted `apps/admin/.next`, which S5 recommends against stale-build 500s, without noticing that the owner's `npm run admin` (started 00:29, port 3000) was using it.
  - I then started my mock server on port 3517 with the same `.next`; as soon as I saw the other process I stopped my server, and **never signalled the owner's process**.
  - The owner's server later exited; the cause was most likely the deleted `.next` plus the `next.config.ts` change below, which makes Next restart.
  - **Action:** restart `npm run admin`.
- **`DSA_ADMIN_DIST_DIR`.** `next.config.ts` now reads an optional `DSA_ADMIN_DIST_DIR` (default `.next`), so a second dev server can run beside the owner's.
  - My mock server used `node_modules/.cache/dsa-admin-mock` (inside the gitignored `node_modules`), deleted afterwards.
  - Next rewrote `tsconfig.json` for that folder (reformatting plus an extra `include`); I restored the committed `tsconfig.json`, and typecheck is clean.

## 7. Open questions

1. **Playable-only count.** Should the page count only playable leaves, like the game (deviation 1)? That would hide the people still under review.
2. **Spine labels in suggestions.** Should they be kept (`… · LES EVANGILES · HOMME`) or dropped, even if the suggestion is shorter?
3. **The generic-clue list.** 101 weak descriptions out of 236 on the transcription; the owner may want to review a sample and extend or narrow `GENERIC_CLUE_PATTERNS`.
4. **Bulk "accept every suggestion".** It would resolve all 101 weak descriptions in one save. It isn't built, because the brief says a suggestion is never applied automatically; a deliberate "Appliquer les suggestions aux descriptions faibles (N)" with a confirmation would still respect that. Wanted?
