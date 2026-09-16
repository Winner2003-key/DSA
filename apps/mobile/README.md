# DSA — the game app (`apps/mobile`)

The Expo app for Android, iOS and the web. French UI. It plays against the Supabase database through RPCs only, or entirely on the device in the offline demo mode.

- Expo SDK 57, expo-router, React Native 0.86, React 19.
- Runs in **Expo Go**: no custom native code. The modules are expo-speech, expo-haptics, expo-font, Reanimated, gesture-handler, safe-area-context and AsyncStorage.
- `@dsa/core` is bundled from `packages/core/src`. Metro's default config detects the npm workspace, so `metro.config.js` is only the default.

## Setup

From the repo root (npm workspaces, Node 22):

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env   # then fill in the values
```

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key. **Never the service role key.** |
| `EXPO_PUBLIC_DSA_GRAPH_SLUG` | `livre` (the book) or `mini` (the 12-name test graph) |
| `EXPO_PUBLIC_DSA_OFFLINE` | `1` plays on the device against the mini graph, with no server. It shows a "MODE HORS LIGNE (démo)" badge. Leave it at `0` otherwise. |

The Supabase project needs **anonymous sign-ins enabled** (DATABASE_SCHEMA.md, "Setup", step 3). Without the two Supabase variables, and with offline mode off, the app starts but shows "L’application n’est pas configurée" when a game starts.

> `EXPO_PUBLIC_*` values are inlined into the bundle at build time, and Metro caches them. **After changing `.env`, restart with `--clear`** (`npx expo start --clear`, `npx expo export -p web --clear`). Otherwise an old value, such as offline mode, can stay in the build.

## Run

```bash
cd apps/mobile
npx expo start            # scan the QR code with Expo Go (Android) or the Camera app (iOS)
npx expo start --web      # in the browser
EXPO_PUBLIC_DSA_OFFLINE=1 npx expo start --clear   # demo with no server
```

The phone and the computer must be on the same network. If they aren't, use `npx expo start --tunnel`.

## Check

```bash
npm run typecheck --workspace apps/mobile   # tsc --noEmit
npm test --workspace apps/mobile            # jest-expo
cd apps/mobile && npx expo-doctor
cd apps/mobile && npx expo export -p web --clear
```

## Deploy web on Vercel

1. Vercel → **Add New… → Project** → import the repository.
2. **Root Directory:** `apps/mobile`. Keep **"Include files outside the root directory in the Build Step"** enabled, because `@dsa/core` lives in `packages/core`.
3. **Framework Preset:** Other. `vercel.json` already sets these, so the form can stay empty:
   - Install Command: `npm install --prefix ../..` (installs the whole workspace)
   - Build Command: `npx expo export -p web --clear`
   - Output Directory: `dist`
4. **Environment Variables** (Production and Preview): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_DSA_GRAPH_SLUG=livre`. Don't set `EXPO_PUBLIC_DSA_OFFLINE`, or set it to `0`.
5. **Deploy.** Changing a variable only takes effect after a redeploy.

The web build is a single-page app (`web.output: "single"`). `vercel.json` rewrites every non-file path to `/index.html`, so `/partie/<id>` survives a reload.

## Android APK (EAS)

```bash
npm install -g eas-cli
cd apps/mobile
eas login
eas init                                   # once: links the project and writes extra.eas.projectId
eas build -p android --profile preview     # internal APK, download link at the end
```

The `preview` profile has no Supabase values of its own. Set them in the EAS project (`eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value … --environment preview`, and the same for the anon key), or add them to `build.preview.env` in `eas.json`. The Android package is the placeholder `com.pahilabs.dsa`.

`development` builds a dev client (internal). Expo Go doesn't need it; it will matter once S7 adds native modules.

## Layout

```
app/                      routes only: _layout, index (Accueil), jouer/ (Préparer la partie), partie/[sessionId], resultat/[sessionId]
src/services/             GameService interface, SupabaseGameService (RPCs), OfflineGameService (@dsa/core)
src/state/                useGame (fetch, polling, AI turns, LOCAL TIREUR_READY phase, exchanges), useSecret, useNames
src/graph/path-layout.ts  pure layout of the revealed path, like the book's mind maps (unit-tested)
src/views/                GameTable (hand-over), DecouvreurView (conversation), TireurView, TireurReadyView
src/components/           GameHeader, ExchangePair, AnswerStamp, SecretCard (flip), PathGraph (SVG, gestures), …
src/speech/               tts.ts (expo-speech / speechSynthesis), stt.ts (interface only, S7)
src/i18n/fr.ts            every string the player sees, including one line per DSA_ error code
src/theme/                palette (dark and light, book answer colours), Zilla Slab type scale, spacing and touch sizes
tests/                    offline scenarios, error mapping, secret never shown, path layout, conversation pairing, homonyms, LOCAL Tireur first
```

The UI contains no game rules. It renders the state JSON from `dsa_get_state` and calls the service.
