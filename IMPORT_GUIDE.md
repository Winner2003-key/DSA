# IMPORT GUIDE — putting the book into the database

For the owner. It takes you from a fresh Supabase project to a playable book graph, and back
again every time the transcription changes.

- The scripts read `data/book/` (the hand transcription, deliberately **not** in git) and write to
  Supabase with the service role key.
- They run on your machine only. **No Docker, no local Supabase.**
- Commands are run from the repository root (`/home/winner/projects/DSA`).
- The scripts speak French, like the game. This guide is in English, like the other documents.

Before the first import, the database must exist: follow *Setup in the Supabase dashboard* in
[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) (run `00_all_migrations.sql`, then `01`, `90` and `02`).

Contents:
1. [One-time setup](#1-one-time-setup)
2. [Check the book](#2-check-the-book)
3. [Dry run](#3-dry-run)
4. [Apply](#4-apply)
5. [Review and approve](#5-review-and-approve)
6. [Publish](#6-publish)
7. [Re-importing after editing a `.dsa` file](#7-re-importing-after-editing-a-dsa-file)
8. [What the importer never overwrites](#8-what-the-importer-never-overwrites)
9. [Backups](#9-backups)
10. [Command reference](#10-command-reference)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. One-time setup

### 1.1 Generate the id salt — once, and keep it forever

```bash
node -e "console.log(crypto.randomUUID())"
```

Copy the value it prints. This is `DSA_ID_SALT`.

**Why it exists.** Every node, edge and character id is a UUID v5 computed from the graph slug and
the node's path in the book. Without a salt, those ingredients are public: a player who sees a
prompt's id could hash each known name against the current clue and find the answer before the
Tireur says anything (GRAPH_SPECIFICATION.md §7). The salt is the one private ingredient.

**Keep it forever, in your password manager.** Changing the salt changes *every* id, so a second
import would insert a complete second copy of the graph next to the first and every review you had
done would be attached to rows nobody uses any more. The salt never goes into git, into the app, or
into Vercel — only into `scripts/.env` on this machine.

### 1.2 Find the service role key

Supabase dashboard → **Project Settings** (gear) → **API**:

| Value | Variable |
|---|---|
| **Project URL** (`https://<ref>.supabase.co`) | `SUPABASE_URL` |
| **service_role** key (newer dashboards: **API Keys → secret key**) | `SUPABASE_SERVICE_ROLE_KEY` |

The service role key bypasses every security policy. It belongs in `scripts/.env` and nowhere else:
never in Vercel, never in the mobile or admin app, never in git.

### 1.3 Fill in `scripts/.env`

```bash
cp scripts/.env.example scripts/.env
```

Then edit `scripts/.env`:

```
SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi…
DSA_ID_SALT=3f6b1c2a-9d4e-4f70-8b1a-2c5d7e9f0a13
```

`scripts/.env` is gitignored. `scripts/.env.example` is committed and holds no secrets. If a
variable is also exported in your shell, the shell wins.

If a value is missing, the importer refuses to start and tells you which one:

```
✗ Variables d'environnement manquantes : DSA_ID_SALT.
```

---

## 2. Check the book

```bash
npm run book:validate
```

This reads `data/book/`, builds the graph in memory and writes nothing. You get the build report,
the validation report and a table of every source page:

```
✓ 53 pages → 1647 nodes, 1646 edges, 1157 characters
✓ 0 build errors
✓ 0 build warnings
✓ 1647 nodes (START 1, QUESTION 14, CATEGORY 285, GROUP 138, CHARACTER 1209)
…
Source              Nœuds  Arêtes  Personnages  NEEDS_REVIEW (nœuds+arêtes)
Colonne vertébrale     33      32            0                        33+32
Page 8                 23      23           18                        23+23
…
TOTAL                1647    1646         1157                    1647+1646
✓ Le livre est valide.
```

The command exits with code 1 if there is any error. **Errors must be fixed in `data/book/` before
importing** — the importer refuses to write a graph that does not validate.

Useful variants:

```bash
npm run book:validate -- --approved          # how many characters would be playable once approved
npm run book:validate -- --json rapport.json # full report as JSON
```

`--approved` answers "is the graph actually playable?" — it pretends everything has been approved
and prints the playable character count (today: 1184 of 1209; the rest sit under the two subtrees
the transcription tagged `{review}`).

`npm run book:validate` works even without `scripts/.env`. It then says
`Sel : absent (identifiants NON salés…)`: the structure is checked, but the ids it computes are not
the ones in the database. That is fine for a local check.

---

## 3. Dry run

```bash
npm run book:import -- --dry-run
```

A dry run is the default: it reads the database, works out exactly what it would insert, update or
leave alone, prints it, and **writes nothing**.

```
DSA — importation du livre
Graphe : livre — DSA — Découverte Sans Alphabet
Mode   : simulation (--dry-run, rien n’est écrit)
Pages  : tout le livre (53 pages)
…
Page 23 — 47 nœuds (+47), 47 arêtes (+47), 34 personnages
…
Total — 1647 nœuds (+1647), 1646 arêtes (+1646), 1157 personnages (+1157)
Inchangés — 0 nœuds, 0 arêtes, 0 personnages
Personnages jouables après import : 0
Simulation terminée : rien n’a été écrit. Relancez avec --apply pour appliquer.
```

How to read the counts: `47 nœuds` is how many rows that page has in total, `(+47)` how many are
new, `(~3)` how many would change, `(=)` nothing to do. `Personnages jouables après import : 0` is
normal on a first import: nothing is APPROVED yet.

---

## 4. Apply

```bash
npm run book:import -- --apply
```

The importer then, in this order:

1. builds `data/book/` with your salt and validates it (it stops here if anything is wrong);
2. reads the current rows of the graph;
3. upserts, in batches of at most 500 rows and in foreign-key order: the graph → the characters →
   the nodes → the node/character links → the edges;
4. writes one `import_batches` row per page, with status `APPLIED` and the page's report;
5. bumps `graphs.version` and writes a `graph_versions` row describing what changed.

It is **idempotent**: running it twice in a row is safe, and the second run reports everything as
unchanged and writes nothing.

New rows arrive as `NEEDS_REVIEW`, or carry the note from a `{review: …}` tag in the transcription.
Nothing is playable until it is APPROVED.

---

## 5. Review and approve

Only `APPROVED` nodes and edges are playable, and a secret can only be a CHARACTER reachable from
START through approved edges.

Two ways to approve:

- **In the admin app** (S5): open the import review, read a page, approve it. This is the normal
  route, and the only one that lets you fix a row before approving it.
- **From the importer**, for pages you have already checked against the paper book:

  ```bash
  npm run book:import -- --pages 8,9,23 --approve --dry-run   # look first
  npm run book:import -- --pages 8,9,23 --approve --apply
  ```

`--pages` takes a list (`8,9,23`) or a range (`8-12`). **The spine is always included**, because
every page hangs off it. Only the rows of those pages are written; the rest of the graph is left
completely alone.

If a page you asked for carries a `{review: …}` note from the transcription, `--approve` approves it
anyway and says so:

```
⚠ --approve a approuvé 2 ligne(s) portant une note « à revoir » :
    • ancien[oui]/…/<clé du nœud marqué {review}>
```

The note itself is kept, so you can still find those rows in the admin.

To check your progress at any time, the dry run prints `Personnages jouables après import : N`.

---

## 6. Publish

```bash
npm run book:import -- --publish --apply
```

`--publish` sets `graphs.status = 'PUBLISHED'`, which is what makes the graph visible to players
(`dsa_create_session` refuses a DRAFT graph for everyone but an admin). It is refused if:

- the build or the validation has errors, or
- no character would be playable — otherwise every game would fail with `DSA_NO_PLAYABLE_SECRET`.

The importer never un-publishes: leaving `--publish` off keeps the status the database already has.

---

## 7. Re-importing after editing a `.dsa` file

1. Edit the file in `data/book/`.
2. `npm run book:validate`
3. `npm run book:import -- --dry-run` and read the diff.
4. `npm run book:import -- --apply`

Rows are matched on their id, which comes from the **node key** — the path of slugs from the root.
So it matters *what* you edited:

| Edit | Effect |
|---|---|
| A CATEGORY or GROUP label | the key changes, so the node and its whole subtree get new keys: the old rows become prune candidates |
| A character's clue or name | the key changes (a CHARACTER key is `clue--name`): a new row appears, the old one becomes a prune candidate |
| A page number, a `{note}`, a `{variant}` | the key is unchanged: a plain update |
| The order of lines | `order_index` on the edges changes: an update, no new rows |
| A `{key: …}` tag | pins a key, so you can rename a label without losing the row and its review |

To keep a row's id (and therefore its review status and its position in the editor) while renaming
it, add `{key: <the old key>}` to the line. The dry run shows the difference between the two cases:
`UPDATE` versus a new row plus a prune candidate.

Rows whose key has disappeared from the transcription are **only reported** by default:

```
⚠ 3 nœuds et 3 arêtes ne sont plus dans le livre (ajoutez --prune pour les supprimer) :
    • ancien[oui]/…/<clé disparue de la transcription>
```

Add `--prune` when you are sure:

```bash
npm run book:import -- --prune --dry-run
npm run book:import -- --prune --apply
```

With `--pages`, pruning is limited to those pages, so a partial import can never delete the rest of
the graph. Deleting a node deletes its edges (`on delete cascade`).

---

## 8. What the importer never overwrites

The book owns the structure. You own the review and the layout.

| Kept, whatever the book says | Note |
|---|---|
| `review_status` | except with `--approve` |
| `review_note` | your note wins over the book's |
| `position_x`, `position_y` | your layout in the graph editor |
| `description`, when you edited it | set `metadata.description_edited = true` on the row (the admin does this for you) |
| `bible_characters.aliases`, when you edited them | `metadata.aliases_edited = true` |
| `name_en`, `gender`, `testament`, `is_active` on a character | the book never fills them in |
| Any metadata key the book does not write | for example your own `layout` or `origin` |
| Whole rows you created in the admin | any row with `metadata.origin = 'admin'` (also a node with an empty `node_key`, though the column is `not null`), and every edge touching such a node |
| `graphs.description` and `graphs.status` | status only changes with `--publish` |

> **For the admin app:** a node or edge created by hand must carry `metadata.origin = 'admin'`.
> That tag is the only thing that tells the importer "this row is not mine": `graph_nodes.node_key`
> is `not null` in the schema, so an admin row cannot be recognised by an empty key alone.

Everything else is book-owned and is refreshed on every import: node type, label, question (the
clue), source page, character link, edge answer label, edge kind, `order_index`, and the book's own
metadata keys (`printed_page`, `extra_pages`, `group_kind`, `qualifier`, `notes`, `variants`,
`same_as`, `source_variants`).

The dry run lists what it is keeping:

```
Travail d’administration conservé : 12 nœuds, 0 arêtes, 3 personnages
    • ancien[oui]/…/<clé du nœud> → review_status, position_x/position_y
Lignes créées dans l’admin, jamais modifiées : 2 nœuds, 1 arêtes
```

---

## 9. Backups

The transcription is not a backup of the database: it has none of your review work, your positions
or your edits. Take a real backup before anything risky (a big re-import, a `--prune`):

```bash
npm run book:export -- --out ~/sauvegardes/livre-2026-09-16.json
```

This writes the graph exactly as the database holds it, as one `GraphData` JSON file (the same shape
`packages/core` uses). Keep it **outside the repository**: it contains the whole book.

Supabase also has its own daily backups (dashboard → Database → Backups).

---

## 10. Command reference

```bash
npm run book:validate [-- options]
npm run book:import -- [options]
npm run book:export -- --out <file.json>
```

Note the `--` before the options: it is how npm passes them through to the script.

**`book:validate`**

| Flag | Effect |
|---|---|
| `--approved` | pretend every row is APPROVED, to see the playable count |
| `--graph <slug>` | another graph slug (default `livre`) |
| `--json <file>` | write the whole report as JSON |
| `--help` | usage |

**`book:import`**

| Flag | Effect |
|---|---|
| `--dry-run` | print everything, write nothing (**the default**) |
| `--apply` | actually write |
| `--pages 8,9,23` | limit to those pages (ranges allowed: `8-12`); the spine is always included |
| `--approve` | mark the imported rows of those pages APPROVED |
| `--publish` | set the graph to PUBLISHED (refused if validation fails or nothing is playable) |
| `--prune` | delete the rows whose key no longer exists in the transcription |
| `--graph <slug>` | graph slug (default `livre`) |
| `--name "…"` | graph name (default `DSA — Découverte Sans Alphabet`) |
| `--json <file>` | write the import report as JSON |
| `--record-dry-run` | also write the `VALIDATED` `import_batches` rows of a dry run |
| `--batch-size <n>` | rows per batch (default 500) |
| `--help` | usage |

**`book:export`**

| Flag | Effect |
|---|---|
| `--out <file>` | output file (required) |
| `--graph <slug>` | graph slug (default `livre`) |

---

## 11. Troubleshooting

| Message | Cause and fix |
|---|---|
| `Variables d'environnement manquantes : …` | `scripts/.env` is missing a value. Copy `scripts/.env.example` and fill it in (§1.3). |
| `graph "livre" needs an id salt (DSA_ID_SALT)` | The graph was built without a salt. Only the test graph `mini` may be unsalted. |
| `Transcription introuvable : data/book/spine.dsa` | `data/book/` is gitignored and must exist on this machine. Restore it from your own copy. |
| `✗ N erreur(s) de construction` | The transcription does not parse. Each line says the file and the line number. Fix it, then `npm run book:validate`. |
| `✗ N erreur(s) de validation : rien n’a été écrit.` | The graph is structurally wrong (a cycle, an unreachable node, two identical answers on one question…). Nothing was written. |
| `Erreur Supabase … Vérifiez SUPABASE_URL…` | Wrong URL, or no internet connection. |
| `Erreur Supabase … Vérifiez SUPABASE_SERVICE_ROLE_KEY…` | You used the anon key. The importer needs the **service_role** key. |
| `Page(s) absente(s) de la transcription : 404.` | `--pages` names a page with no `pNNN.dsa` file. The message lists the pages that do exist. |
| `N arête(s) pointent vers des nœuds absents…` | A selected page hangs off a node that belongs to another page. Import that page too, or run a full import. |
| `Aucun personnage jouable` on `--publish` | Nothing is APPROVED yet. Approve pages first (§5). |
| The app says `DSA_NO_PLAYABLE_SECRET` | Same cause, seen from the game: approve nodes and edges, and re-publish. |
| The app says `DSA_GRAPH_NOT_FOUND` | The graph is still DRAFT or inactive. Run `--publish --apply`. |
| A second copy of the graph appeared | The salt changed between two imports. Restore the original `DSA_ID_SALT`; the rows written with the wrong salt can be deleted in the admin. |
| The import seems stuck | A full first import writes ~4,500 rows in batches of 500. Give it a minute; each batch is logged as it lands. |
