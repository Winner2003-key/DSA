# Brief S5b — Admin: the "Homonymes" page

You are a senior React / Next.js engineer on **DSA — Découverte Sans Alphabet**. Repo: `/home/winner/projects/DSA`.

S5 built the admin (graphs list, editor, page review) but **not** feature 5 of `docs/sessions/S5-admin.md` (the Homonymes page). Feature 6 (Réglages / timer) belongs to S9 and is **not** part of this session.

## Read first
1. `docs/sessions/README.md` (global rules: no Docker, no commit, French UI, **public repo: never write the source book's title, author or organisation**; the book graph's slug is `livre`)
2. `docs/sessions/S5-admin.md`, **feature 5** (the spec of this page), and `docs/sessions/reports/S5-admin.md` (what exists: repository, diff and save, the edit flags from §5.5, and mock mode)
3. `GRAPH_SPECIFICATION.md` §8 (the description is shown to the Tireur only when the name is shared)
4. `docs/sessions/reports/S3b-game-ux.md` (how the app renders the Tireur's card, so the preview matches it)

## You own
`apps/admin/**` only.

## Deliver
- **Route** `/graphes/[slug]/homonymes`, linked from the graph's pages (the graphs list, the editor header, the review page).
- **The list:** every name (`normalizeName(label)`) carried by CHARACTER nodes of **different** characters (aliases of one person don't count), grouped by name, with the number of people. For each person:
  - the current character description;
  - the book path (a breadcrumb from the root, as in the editor);
  - the source page;
  - the review status;
  - a link "Ouvrir dans l'éditeur" focused on the node.
- **Filters:** Tous / Descriptions faibles (the clue is only an ordinal or a generic word: "1er", "2ème", "Le 1er", "Son père", "Le dernier", "plus connu"…; put the list in one tested helper) / Déjà modifiées (`metadata.description_edited`) / **Identiques** (two people of the same name with the same description).
- **Inline editing** of the description, with a **live preview of the Tireur's card** (the name large, the description small, same order and emphasis as in the mobile app), and one "Enregistrer" for the page, reusing the S5 diff and save path. Saving sets `description_edited = true` on the character, and keeps the CHARACTER node's `description` in sync.
- **"Suggérer" button:** proposes `clue · parent label · grandparent label` from the book path (for example `1er · SES PETITS FILS · LIE A SEM`) into the field, **never saved automatically**.
- **Counters** at the top: names shared, people involved, descriptions still weak or identical.
- **Mock mode** (`NEXT_PUBLIC_DSA_MOCK=1`): the mini graph has JACQUES ×2, which is enough to exercise the page.

## Verification (paste the output)
- `npm run typecheck`, `npm test` and `npm run build --workspace apps/admin`;
- tests for: grouping (aliases excluded, names normalized), the weak-description detector, the identical-description detector, the suggestion builder, and the diff produced by an edit (description plus flag);
- headless screenshots in mock mode into `docs/sessions/reports/S5b-screens/`.

## Report
Write `docs/sessions/reports/S5b-admin-homonyms.md` with files, outputs, deviations and open questions.
