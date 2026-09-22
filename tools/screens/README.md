# tools/screens — the shared screenshot harness

Committed so no session has to build one again. It serves an Expo web export, drives the app
through a small JSON scenario and writes the screenshots plus a `screens.md` index.

No Docker and no browser download: it drives the **system Chrome** through `playwright-core`,
which you install in your scratchpad, never in the repo.

## Use it

```bash
# 1. build the web export once (offline mode needs no Supabase credentials)
cd apps/mobile && EXPO_PUBLIC_DSA_OFFLINE=1 npx expo export -p web && cd -

# 2. playwright-core in your scratchpad
npm i --prefix "$SCRATCH" --no-save playwright-core

# 3. capture
PLAYWRIGHT_DIR="$SCRATCH/node_modules/playwright-core" \
node tools/screens/capture.mjs \
  --scenario tools/screens/scenarios/S10-ui.json \
  --out docs/sessions/reports/S10-screens
```

Exit code is non-zero if the page logged an error or a request failed — that is a real finding,
put it in your report.

## Scenarios

Copy `scenarios/example.json`. One file per session, committed next to the others.

```json
{
  "title": "S10 — the UI pass",
  "theme": "light",
  "shots": [
    { "name": "01-accueil", "path": "/", "note": "what it shows" },
    { "name": "02-table", "path": "/jouer",
      "actions": [ { "waitFor": "Préparer" }, { "click": "Découvreur" }, { "wait": 200 } ],
      "note": "..." }
  ]
}
```

Actions, in order:

| Action | Meaning |
|---|---|
| `{ "click": "Texte" }` | click the first element containing that text |
| `{ "click": { "testId": "..." } }` | click by `testID` |
| `{ "click": { "label": "..." } }` | click by accessibility label |
| `{ "fill": { "label": "Nom", "value": "Ana" } }` | type into a field (`testId` also works) |
| `{ "press": "Enter" }` | a key |
| `{ "wait": 300 }` | milliseconds |
| `{ "waitFor": "Texte" }` | wait until that text appears (15 s timeout) |
| `{ "eval": "..." }` | run JS in the page, for a state the UI cannot reach |

Per-shot: `path`, `theme`, `settle` (ms before the shot), `fullPage`.

## Options

`--scenario` `--out` (both required) · `--dist` · `--scale` (default 1) · `--width` `--height`
(default 390×844) · `--theme` (force one) · `--port` · `--keep-open`.

## The rules that keep this cheap

From `docs/sessions/CHECKS.md` §4:

- **at most 8 screenshots per session**, only the screens your work changed;
- **one theme**, unless the change is about theming;
- **scale 1.** A 780×1688 image costs a later reader about three times the tokens of a
  390×844 one, for the same information. `--scale 2` only to show a fine detail;
- **describe each screen in words in your report.** The next session reads the words.
