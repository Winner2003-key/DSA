# DSA — the game app (`apps/mobile`)

The Expo app for Android, iOS and the web. French UI. It plays against the Supabase database through RPCs only, or entirely on the device in the offline demo mode.

- Expo SDK 57, expo-router, React Native 0.86, React 19.
- Runs in **Expo Go**: no custom native code. The modules are expo-speech, expo-haptics, expo-font, expo-camera (QR scanning), Reanimated, gesture-handler, react-native-svg (with react-native-qrcode-svg), safe-area-context and AsyncStorage.
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
| `EXPO_PUBLIC_DSA_OFFLINE` | `1` plays on the device against the mini graph, with no server. It shows a "MODE HORS LIGNE (démo)" badge. Leave it at `0` otherwise. Rooms ("Jouer avec un ami") need the server and are disabled in this mode. |
| `EXPO_PUBLIC_DSA_WEB_URL` | Optional. The public web address (for example `https://dsa.vercel.app`). Room QR codes and shared links then open `…/rejoindre/DSA-1234` there, which any phone camera can open. Without it they carry the app's own link (`dsa://rejoindre/…` in a build, `exp://…/--/rejoindre/…` in Expo Go, the current address on the web). |

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

## Rooms: two phones ("Jouer avec un ami")

- **Create:** Accueil → Jouer avec un ami → Créer une partie → role, name, Façon de jouer → the lobby shows the code, **Partager** and a QR code, and each seat's presence.
- **Join:** Rejoindre une partie → type the code (`DSA-` is added; `dsa1234` or `1234` also work) or **Scanner le QR code**. Links open the same screen: `dsa://rejoindre/DSA-1234` and the web route `/rejoindre/DSA-1234`; with a remembered name the room is joined at once.
- **Server:** needs `05_rooms.sql` (or the current `00`) on the Supabase project. Realtime pushes changes (`postgres_changes` on the game tables); while the channel is down the app polls every 5 s and shows "Connexion perdue… reconnexion".
- **Scanning in Expo Go:** `expo-camera` is part of Expo Go, so the in-app scanner works there and in browsers with a camera. A phone's own camera app can also scan the lobby QR code; it opens the link it carries (see `EXPO_PUBLIC_DSA_WEB_URL`).

## The chronometer ("Jouer avec le chronomètre")

- **Optional, and off by default.** The checkbox is in Préparer la partie, for a solo or LOCAL game and for the room creator (who chooses for both phones; the lobby shows it read-only). Its line quotes the real durations, read from the server with `dsa_timer_defaults`.
- **Two clocks.** The Tireur gets **40 s** to work out the book's path to the card ("Je suis prêt" ends it early), then both players get **2 min** to find the name. Nothing extends the game time: rewinds, going back and wrong name calls all spend the same seconds. If the name isn't found, the game ends `TIME_UP` and both players lose.
- **The server owns the time.** Every state carries `server_now` and the deadlines, and the countdown is computed against those — never against the phone's clock. A phone that reconnects or comes back from the background shows the right seconds at once. The countdown is a ring: in the header during play, larger during the thinking time, changing colour at 30 s and at 10 s with a short haptic (reduced motion respected).
- **Server:** needs `06_timer.sql` (or the current `00`). The admin sets the three values under **Réglages**; they apply to new games only.
- **Changing the name:** while looking at the card, a Tireur who cannot find that name in the book may draw another one — **twice by default, and only before the questions start**. A name already drawn never comes back, and the Découvreur is only told that the name changed.
- **The preparation phase now exists in every mode with a human Tireur** (LOCAL and AI Découvreur too, not just rooms), timed or not. Nothing listens on the microphone during it.

## Practising one part of the book ("Choisir une partie")

- In Préparer la partie (and in room creation, where the creator chooses for both phones; the lobby shows it read-only): **« Tout le livre »**, the default, or **« Choisir une partie »**, which opens a picker of the book's sections as a compact tree with the number of names on each, "tout cocher" on any branch, and multi-select.
- **It changes only which name is drawn.** The questions still start at the first one, so the pair walks the whole book down to that part and keeps learning the path. The game screen writes « Partie : LES EVANGILES » under the header.
- The picker is fed by `dsa_list_sections`, which returns labels, parents, depths and counts and **never a name, a clue or a leaf** — no more than the book's table of contents.
- Name changes stay inside the chosen part, and a rematch keeps it.
- **Server:** needs `07_rules_scope.sql` (or the current `00`).

## "QUESTION" — going back a whole list

The Tireur's **QUESTION ×1/×2/×3** sends the pair back to the question that **opened the list they are in**, not to the previous answer (GAME_RULES §4), so a mistake is undone in one step. ×2 goes one list higher, ×3 one higher still; asking for more lists than were opened goes back to the very first question. The Découvreur reads a notice saying which question to ask again. In Voix the intent is unchanged: the word "question" said one, two or three times.

## The end of every game

The result screen shows the game card first — "Trouvé !", "Temps écoulé" or "Partie arrêtée", the name, the statistics and, for a timed game that was won, "Trouvé en 1 min 12 s sur 2 min" — and then **the book's own path to that name** in the animated `PathGraph`: every question in book order with the right answers, down to the card. It is not the players' path, which stays behind "Voir le chemin" during play.

## Voice ("Façon de jouer : Voix")

- **Choose it** in Préparer la partie (solo, LOCAL, or the room creator for both phones). A voice game is voice only: no answer pad, no name keyboard, no "Poser la question" / "Revenir" / QUESTION ×N buttons. The preparation phase (card, "Je suis prêt", "Changer de nom") is unchanged.
- **Server:** the `transcribe` Edge Function must be deployed (`VOICE.md`). Without it, or without `EXPO_PUBLIC_SUPABASE_URL`, pressing the mic shows a French banner that says to quit and start again with Boutons.
- **Talking:** like a voice note. Hold the round microphone and talk, release to send. Slide up while holding to lock it: keep talking hands free, then touch it once to send (25 s at most). A screen reader's double tap starts a locked recording, and a second one sends it.
- **Découvreur:** say the question ("Ancien ?"), a name ("Absalom !") or "revenir à Pentateuque". The phone speaks the answer. A "revenir" that names no question is asked again out loud.
- **Tireur:** the phone speaks the question; say OUI, NON, a held OUIIII / NONNNN, or "question" ×N. A borderline length is asked again out loud ("Redis-le").
- **Calibration:** offered the first time someone is Tireur with Voix, every time on a shared phone ("Calibrer pour ce Tireur"), and in Réglages de la voix. Stored per device (AsyncStorage).
- **Microphone:** `expo-audio` (in Expo Go) on phones, `getUserMedia` + `MediaRecorder` in browsers (https or localhost only). Text-to-speech is held back while the mic is open.

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
app/                      routes only: _layout, index (Accueil), voix (Réglages de la voix), ami/ (Jouer avec un ami), jouer/ (Préparer la partie; ?ami=1 for a room),
                          rejoindre/ and rejoindre/[code] (join by code, link or QR), partie/[sessionId] (lobby + game), resultat/[sessionId] (+ Rejouer)
src/services/             GameService interface, SupabaseGameService (RPCs + Realtime subscribe), OfflineGameService (@dsa/core),
                          realtime-sync.ts (debounce, fallback polling)
src/state/                useGame (fetch, realtime sync, AI turns, the preparation phase, the clock, name changes, exchanges, connection),
                          use-countdown (the server-clock countdown), useSecret, useNames
src/rooms/                room codes and join links, the room:<code> channel (presence, broadcast), the room state machine,
                          rematch, the remembered player name, share
src/graph/path-layout.ts  pure layout of the revealed path, like the book's mind maps (unit-tested)
src/views/                GameTable (hand-over), DecouvreurView (conversation), TireurView, TireurReadyView,
                          RoomTable (lobby, banners), LobbyView, DecouvreurWaitingView, JoinView,
                          voice-play (DecouvreurVoice, TireurVoice), calibration-panel (panel, sheet, offer)
src/components/           GameHeader, ExchangePair, AnswerStamp, SecretCard (flip), PathGraph (SVG, gestures),
                          CountdownRing, CheckCard, ScopePicker (the book's sections as a tree), …
src/speech/               tts.ts (expo-speech / speechSynthesis), use-speech (mute, held back while listening),
                          recorder.native.ts / recorder.web.ts (one Recorder interface), transcriber.ts (Edge Function client),
                          use-voice-capture (hold / free talk), use-voice-turn (transcribe, fallbacks), interpret.ts (pure),
                          voice-settings.ts (talk mode, calibration)
src/i18n/fr.ts            every string the player sees, including one line per DSA_ error code
src/theme/                palette (dark and light, book answer colours), Zilla Slab type scale, spacing and touch sizes
tests/                    offline scenarios, error mapping, secret never shown, path layout, conversation pairing, homonyms, LOCAL Tireur first,
                          room codes, realtime sync, room state machine, rematch, rooms flow, useGame realtime,
                          voice (interpret, game flows with a fake mic, calibration, rooms + "Est-ce" snapshot),
                          timer (fake clock), redraw ("Changer de nom"), result + the book's path,
                          rewind-rule ("QUESTION" goes back a list), scope (practising one part of the book)
```

The UI contains no game rules. It renders the state JSON from `dsa_get_state` and calls the service.
