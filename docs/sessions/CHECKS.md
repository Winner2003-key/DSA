# Checks: what to run, and when

**Measured on the owner's machine, 2026-09-22.** Briefs link here instead of repeating commands.

The point of this file: earlier sessions ran the whole suite after every small edit, rebuilt a
screenshot harness from scratch, and re-verified SQL that had not changed. That is where the
hours went — not in the tests themselves, which are fast.

---

## 1. While you work: run only what you changed

| Changed | Command | Time |
|---|---|---|
| `packages/core` | `npm test --workspace packages/core` | **4 s** (200 tests) |
| `packages/voice` | `npm test --workspace packages/voice` | **4 s** (165 tests) |
| `apps/mobile` | `npx jest --ci <one test file>` from `apps/mobile` | **2–14 s** |
| a type | `npm run typecheck --workspace <ws>` | **4–10 s** |

Jest takes a path filter: `npx jest --ci tests/timer` runs one suite. Use it. There is no
reason to run 233 tests to check one component.

## 2. Before writing your report: the full sweep, once

```bash
npm test --workspaces --if-present     # core 4 s · voice 4 s · mobile 16 s · scripts 3 s
npm run typecheck --workspaces --if-present
cd apps/mobile && npx expo export -p web   # ~15 s warm, 40 s with --clear
```

- **Drop `--clear`.** It throws away the Metro cache and triples the build. Use it only if the
  export behaves strangely.
- Run the export **once**, at the end. `tsc` and jest already catch code errors; the export
  proves the web bundle links.
- Paste the summary lines into your report — the counts and the exit status, not the full log.

## 3. `expo-doctor`: only when dependencies change

20 s, and it hits the network. If you did not touch `package.json`, skip it and say so.

**Known, not yours.** As of 2026-09-22 it reports 3 packages out of date, all patch-level
inside SDK 57:

| Package | Installed | Expected |
|---|---|---|
| `expo` | 57.0.23 | ~57.0.24 |
| `expo-constants` | 57.0.18 | ~57.0.19 |
| `expo-router` | 57.0.21 | ~57.0.22 |

That is one owner-level upgrade (`cd apps/mobile && npx expo install --check`), done between
sessions so it never lands in the middle of someone's work. **Do not spend turns on it**, and
do not run `expo install --check` unless your brief says to. Every other expo-doctor check
passes.

## 4. Screenshots: use the shared harness, do not build one

`tools/screens/` is committed. It serves the web export, drives the app and captures screens
from a small JSON scenario. See `tools/screens/README.md`.

```bash
cd apps/mobile && npx expo export -p web
node tools/screens/capture.mjs --scenario tools/screens/scenarios/<yours>.json \
     --out docs/sessions/reports/S<NN>-screens
```

Rules, so the next session does not pay for your pictures:

- **At most 8 screenshots per session**, and only screens your work changed.
- **One theme** (light) unless the change is about theming, and then one extra pair.
- **Scale 1** (390×844). `--scale 2` only when you must show a fine detail. A 780×1688 image
  costs a reader about three times as many tokens as a 390×844 one, for the same information.
- The harness writes a `screens.md` index next to the images. **Describe each screen in words
  in your report.** A later session reads the words, not the pictures.
- **Then delete the images.** A screenshot is a means, not a deliverable: once you have written
  down what it told you, the PNG is dead weight in a public repo and a bill for every session
  that opens it. Commit the **scenario JSON** instead — anyone can regenerate the pictures from
  it in a minute. (2026-09-23: 140 images, 13 MB, were removed from `reports/` this way; every
  report already described them.)
- **Never re-capture a screen an earlier report already describes.** Read that report's screens
  table. If you need something no table answers, shoot that **one** screen, write down what it
  told you, and delete it.

## 5. SQL: verify the path that actually changed

No Docker. `libpg-query` (the real PostgreSQL parser) and `@electric-sql/pglite` (Postgres in
WASM), both installed **in your scratchpad, never in the repo**.

- Regenerate the bundle with `bash supabase/sql-editor/build.sh`. **Never hand-edit
  `00_all_migrations.sql`** — it is 5,700 generated lines.
- Verify the **upgrade path** (the owner's real situation: an existing project + your new file
  + `90_tests.sql`). That is the one that can break.
- Verify the **fresh path** (`00 → 01 → 90`) only when you changed an existing migration, not
  when you only added a new numbered file — `build.sh` concatenation is mechanical.
- Mutation checks (deliberately breaking a rule to prove a test catches it) are worth it for
  new security rules. A handful is enough; earlier sessions ran fifteen.

## 6. What not to do

- Don't look for previous sessions' screenshot folders — they no longer exist. Read
  `docs/sessions/CONTEXT.md` and the report's Screens section in words.
- Don't keep screenshots after your report describes them, and don't take two of the same thing.
- Don't read a whole previous report. Read its **§1 Files** table.
- Don't re-run the full suite after every edit.
- Don't install browsers, Postgres or Docker into the repo.
- Don't paste hundred-line logs into the report. Summary lines only.
