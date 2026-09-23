# Report S7b — Voice in the app: speak to play (Expo Go and web)

**Status: done.** Every item in the brief is built and tested:
- the recording layer (native and web);
- hold-to-talk and free talk, with live states;
- the Découvreur and the Tireur by voice, including the borderline-confirm buttons;
- the calibration screen;
- "Façon de jouer : Voix" enabled, with fallbacks;
- AI modes and rooms spoken aloud.

**Test results:**
- mobile: 167 tests (135 before), 1 snapshot, typecheck clean;
- voice: 165 tests (158 before), typecheck clean;
- core: 170 tests, unchanged;
- `expo-doctor`: 21/21;
- the web export succeeds.

**Checked in a real browser.** The web recorder was checked end to end in headless Chrome, with a fake microphone playing generated sounds (§2.3):
- `getUserMedia`, `MediaRecorder` and `AnalyserNode` all work;
- free talk stops by itself after the sound;
- a short, medium and long sound gave **NON**, **the confirm buttons** and **NONONONON**;
- the multipart upload has the right headers, type and hint;
- 0 page or console errors.

**Not verified:**
- **Expo Go on real phones.** The native recorder (`recorder.native.ts`, expo-audio) is type-checked against the installed SDK 57 package and follows the Expo docs, but it has never recorded on a device. The manual checklist in §4 is that check.
- **A live `transcribe` call on the owner's project.** No request was sent there, and no anonymous user was created. The browser check intercepted Supabase locally.

Nothing was committed.

> **Other sessions ran at the same time.** Changes to `GAME_RULES.md`, `GRAPH_SPECIFICATION.md` (§9 rewritten for S9), `docs/sessions/S9-timed-games.md` and `apps/admin/` are not mine, and I didn't touch them. S6's uncommitted room work is still in the tree; I built on it.

---

## 1. What the owner must do

- **No SQL** in this session.
- **Voice needs the `transcribe` function deployed** (`VOICE.md` steps 1–5). Without it, the mic shows the server's French message and the game carries on with the buttons.
- **Phones:** `cd apps/mobile && npx expo start --clear`, then follow the checklist in §4. The first mic use asks for permission, in French:
  - iOS: `NSMicrophoneUsageDescription`;
  - Android: `RECORD_AUDIO`, from the `expo-audio` plugin.
- **Web (Vercel):** nothing to change. The microphone needs https, which Vercel provides (or `localhost`).

## 2. Verification output

### 2.1 Tests, typecheck, doctor, export

```
$ npm run typecheck --workspace apps/mobile
> tsc --noEmit                                   (exit 0)

$ npm test --workspace apps/mobile
PASS tests/offline-game.test.tsx
PASS tests/path-layout.test.ts
PASS tests/use-game-realtime.test.tsx
PASS tests/supabase-errors.test.ts
PASS tests/voice-interpret.test.ts
PASS tests/realtime-sync.test.ts
PASS tests/room-phase.test.ts
PASS tests/room-code.test.ts
PASS tests/rematch.test.ts
PASS tests/homonym-description.test.tsx
PASS tests/local-tireur-first.test.tsx
PASS tests/decouvreur-never-sees-the-secret.test.tsx
PASS tests/decouvreur-conversation.test.tsx
PASS tests/question-phrasing.test.tsx
PASS tests/voice-calibration.test.tsx
PASS tests/rooms-flow.test.tsx
PASS tests/voice-rooms-phrasing.test.tsx
PASS tests/voice-play.test.tsx
Test Suites: 18 passed, 18 total
Tests:       167 passed, 167 total
Snapshots:   1 passed, 1 total

$ npm run typecheck --workspace packages/voice
> tsc --noEmit && tsc --noEmit -p tsconfig.test.json      (exit 0)

$ npm test --workspace packages/voice
 ✓ test/purity.test.ts (4 tests)
 ✓ test/endpoint.test.ts (7 tests)          ← new
 ✓ test/calibration.test.ts (8 tests)
 ✓ test/envelope.test.ts (26 tests)
 ✓ test/speakable.test.ts (49 tests)
 ✓ test/transcribe-client.test.ts (7 tests)
 ✓ test/answer-decision.test.ts (37 tests)
 ✓ test/transcribe-function.test.ts (27 tests)
 Test Files  8 passed (8)
      Tests  165 passed (165)

$ npm test --workspace packages/core     →  Test Files 11 passed (11) · Tests 170 passed (170)   (unchanged)

$ cd apps/mobile && npx expo-doctor
21/21 checks passed. No issues detected!

$ npx expo export -p web --clear
› web bundles (2):
_expo/static/js/web/entry-0e87ba750b49aa12fe331caf7ca8b0eb.js (2.9MB)
_expo/static/js/web/index-bc5e54c8e8c93d4e69bc3691f3adf91f.js (45KB)
Exported: dist
```

**act() warnings.** The suite also prints no act() warnings. An intermittent one came from the hold-to-talk test: its 400 ms release tail fired outside `act()`. That wait is now wrapped. Eight full runs in a row were clean, checked with a trace hook that prints the test name on every act() warning.

### 2.2 What the new tests prove (brief's list)

**`voice-interpret.test.ts`** (12 tests, pure logic):
- **Découvreur:**
  - "Ancien ?" → ASK; "Lié à Adam ?" → ASK; "Est-ce que c'est dans le Pentateuque ?" → ASK;
  - **"Absalom !" → GUESS ABSALOM**; "Caïn." → GUESS CAÏN;
  - **"Revenir à Pentateuque." → BACK step 2**; "Revenir en arrière" → BACK with no step (the list opens);
  - noise (`''`, `...`, "Euh", a Whisper hallucination), or a different question than the current one → UNKNOWN;
  - "revenir à Ancien" at the first question → UNKNOWN.
- **Tireur:**
  - **long envelope + "Oui." → OUIOUIOUI; short → OUI; 650 ms → CONFIRM [OUI, OUIOUIOUI]**;
  - a slow speaker's stored calibration turns 1000 ms into OUI;
  - **"Question, question." → REWIND 2**;
  - a name call takes only OUI or NON (a long "oui" is still OUI), and "question" is UNKNOWN there;
  - noise → UNKNOWN.
- **Calibration live test:** SIMPLE, REPEATED, BORDERLINE and NO_SOUND, and three short bursts → REPEATED.
- The transcript is cleaned for the "J'ai entendu" line.

**`voice-play.test.tsx`** (11 tests): the real `GameTable`, `useGame` and `OfflineGameService`, a scripted mic (`tests/fake-recorder.ts`) and a mocked transcriber.
- **AI Tireur, "Ancien ?":**
  - `service.ask` is called, and the prompt moves to HOMME;
  - "J'ai entendu : « Ancien »" is shown;
  - **"Oui." is spoken**, and the next question is not;
  - TTS was stopped before recording;
  - the hint contains "Ancien ?" and a duration;
  - the Ask button is still there.
- **Noise:** "Je n'ai pas bien compris. Peux-tu répéter ?" is shown **and spoken**, and nothing is asked.
- **By voice:** Ancien → Homme → Pentateuque; **"Abram !"** → `guess(ABRAM)`, refused and shown; **"Revenir à Homme."** → `goBack(1)`, and HOMME is asked again.
- **Hold to talk (the default):**
  - "Maintiens le bouton et parle";
  - `pressIn` shows the level meter;
  - after `pressOut`, nothing stops for 200 ms (the tail);
  - then it stops, transcribes and asks.
- **AI Découvreur, at PENTATEUQUE:**
  - "Pentateuque ?" is spoken (never "Est-ce");
  - **a long "Non." → `answer(NONONONON)`** → LIVRE DE SAMUEL;
  - **a short one → `answer(NON)`**;
  - **650 ms → the two confirm buttons** (NON / NON NON NON): nothing is sent until the tap, and the tap sends NONONONON;
  - **"Question, question." → `rewind(2)`** → back to ANCIEN;
  - the answer pad stays visible throughout.
- **Permission denied:**
  - the banner "Le micro est refusé…" appears;
  - the mic button is hidden;
  - no transcription is attempted;
  - **Poser la question still works**, and HOMME comes next.
- **Rate limit (429) and network errors:** the server's French message is shown in the banner, the mic stays for a retry, the buttons stay, and "Fermer" hides the banner.
- **The mic is only active on your turn:** while the AI Découvreur thinks, the button reads "Le micro s'allume à ton tour.", is disabled, and pressing it doesn't record.

**`voice-calibration.test.tsx`** (6 tests):
- **The takes:**
  - "Dis OUI normalement", Essai 1 sur 2;
  - a silent take → "Je n'ai rien entendu…", and the same take is asked again;
  - 300 and 400 ms, then "Dis OUIIII en le tenant longtemps", 1100 and 1300 ms.
- **The result:**
  - "Ton OUI dure 0,4 s", "Ton OUIIII dure 1,2 s", "Au-delà de 0,8 s, c'est OUI OUI OUI";
  - stored in AsyncStorage as `{thresholdMs: 775, shortMedianMs: 350, longMedianMs: 1200, quality: 'good'}`.
- **The live test:** 1400 ms → "J'ai compris : OUI OUI OUI"; 300 ms → "J'ai compris : OUI"; 800 ms → "Entre les deux…"; then Terminé.
- **Warnings:**
  - sounds that are too alike → the "se ressemblent" warning;
  - a refused mic → a banner, no crash.
- **Réglages de la voix:**
  - shows the stored values;
  - the talk mode is saved;
  - "Refaire le réglage" starts the takes.
- **The offer:**
  - offered to a Tireur with Voix; "Plus tard" hides it and is remembered;
  - a Buttons game shows neither the offer nor a mic.
- **LOCAL:** "Calibrer pour ce Tireur" shows in the ready phase **even when a calibration is stored**, and opens the sheet.

**`voice-rooms-phrasing.test.tsx`** (3 tests):
- **Rooms (brief §8):** the same game is seen as one phone of a HUMAN_VS_HUMAN VOICE room.
  - When the other phone's question arrives, the **Tireur's phone speaks exactly `["Ancien ?"]`** and its mic turns on.
  - When the other phone's answer arrives, the **Découvreur's phone speaks exactly `["Oui."]`**, and its mic goes from disabled to ready.
- **The "Est-ce" snapshot:** a scripted voice game in both AI modes, including a player who *says* "Est-ce un homme ?".
  - Every TTS utterance and every rendered string is checked for "Est-ce" (only the "J'ai entendu" echo of the player's own words is exempt).
  - The utterance list is a snapshot: `Oui.`, `Je n'ai pas bien compris. Peux-tu répéter ?`, `Oui.`, `Non.`, `Ancien ?`, `Homme ?`, `Pentateuque ?`.
  - **It found a real bug:** a second "Oui." in a row wasn't spoken (fixed, deviation 12).

**`packages/voice/test/endpoint.test.ts`** (7 tests): `detectEndOfSpeech`.
- 800 ms / 8 s constants.
- It stops 800–850 ms after a short "oui".
- It doesn't stop inside a held sound or a 400 ms pause between words.
- It never stops on silence before any voice, only at 8 s.
- It stops at 8 s in constant noise.
- Custom limits work.

**Existing tests:** `question-phrasing.test.tsx` now expects the **speakable** TTS forms ("Homme ?", "Ancien ?", "Absalom ?"). The screen still shows `HOMME ?`.

### 2.3 Web recording in real Chrome (headless, scratchpad only)

**Setup:**
- a web build with `EXPO_PUBLIC_DSA_OFFLINE=1`, `EXPO_PUBLIC_DSA_GRAPH_SLUG=mini` and a **fake** `EXPO_PUBLIC_SUPABASE_URL=https://fake-dsa.supabase.co`;
- Playwright (`playwright-core` in the scratchpad) driving the system Chrome, with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`;
- WAV files generated by a script: 1 s of silence, a 220 Hz tone of 300 ms, 600 ms or 1200 ms (the "voice"), then silence;
- `/auth/v1/signup` and `/functions/v1/transcribe` intercepted in the browser. The transcribe interception records the multipart body and returns a scripted text.

Chrome restarts the file for each `getUserMedia`, so every take hears silence → tone → silence.

```
== /voix, "Parler librement", short.wav (300 ms tone)
take 1..4 → auto-stopped after 2311 / 2322 / 2314 / 2305 ms        (tone ends at 1300 ms → +800 ms silence ≈ 2.3 s)
summary: Ton OUI dure 0,4 s  Ton OUIIII dure 0,4 s  Au-delà de 0,6 s, c'est OUI OUI OUI  Tes deux sons se ressemblent…
live test (auto-stop 2312 ms): J'ai compris : OUI
errors: none

== /voix, long.wav (1200 ms tone)
take 1..4 → auto-stopped after 3323 / 3323 / 3317 / 3322 ms
summary: Ton OUI dure 1,3 s  Ton OUIIII dure 1,3 s  Au-delà de 1,3 s, …   (same file every take → "weak", as expected)
live test (auto-stop 3315 ms): Entre les deux : pendant la partie, je te demanderai de choisir.
errors: none

== Préparer la partie → "Je suis le Tireur" (AI Découvreur) → Voix → calibration offer → Plus tard
== hold to talk (mouse down 3 s, up), transcripts scripted "Oui." "Oui." "Non."
long.wav:  ANCIEN ? heard « Oui » · HOMME ? heard « Oui » · PENTATEUQUE ? heard « Non » → next: LIVRE DE SAMUEL ?      (NONONONON)
short.wav: … PENTATEUQUE ? heard « Non » → next: Serviteur de MOÏSE ?                                               (NON)
mid.wav:   … PENTATEUQUE ? heard « Non » → CONFIRM buttons shown                                                   (borderline)
uploads (each): {"file":"parole.webm","type":"audio/webm;codecs=opus","bytes":~57000,"auth":"Bearer user-jwt",
                 "apikey":"fake-anon","hint":"Pentateuque ? Oui, non, je ne sais pas, question.","durationMs":"3493"}
errors: none

== Découvreur (AI Tireur), hold to talk, transcripts "Ancien ?" then a Whisper hallucination
prompt: ANCIEN ?
heard: J'ai entendu : « Ancien »; latest: Tu as demandé ANCIEN ? Le Tireur OUI; next: HOMME ?
notice: Je n'ai pas bien compris. Peux-tu répéter ?
hint: "Ancien ? Oui, non, je ne sais pas, question. Abraham, Abram, Adam, Caïn, David, Esdras, Isaac, Ismaël, Jacques, Jéroboam, Jésus-Christ, Josué."
errors: none
```

A 300 ms tone measures **0.4 s** and a 1200 ms tone **1.3 s**. The analyser and the 50 ms frames add about one frame, which is well inside the default 650 ms ± 15 % band. The real sound classification works in the browser.

**Screenshots** (`docs/sessions/reports/S7b-screens/`, 390×844 @2x, light theme, offline demo):

> **The images were deleted on 2026-09-23.** The table below *is* the record. Don't re-capture these screens to find out what they showed — read the words. If you need a picture of something this table doesn't answer, capture only that one screen with `tools/screens/`, write down what it told you, and delete it again.


| File | State |
|---|---|
| 01-setup-voix-selectable | Préparer la partie: "Voix" selected (no longer "Bientôt") |
| 02-tireur-calibration-offer | First Tireur game with Voix: "Régler ta voix ?" with Plus tard / Régler ma voix |
| 03-tireur-listening-level | Hold to talk: red "Je t'écoute…" slab with the level meter; the OUI/NON pad below |
| 04-tireur-borderline-confirm | "Tu as dit lequel ?": NON / NON NON NON, full width |
| 05-tireur-after-long-non | After a long "non": LIVRE DE SAMUEL ?, "J'ai entendu : « Non »" |
| 06-decouvreur-ready | Découvreur: first question card, mic "Maintiens le bouton et parle" |
| 07-decouvreur-heard-and-answered | "Tu as demandé ANCIEN ?" → OUI; HOMME ? next |
| 08-decouvreur-not-understood | "Je n'ai pas bien compris. Peux-tu répéter ?" |
| 09-calibration-result | Réglages de la voix: measured values, weak warning, live test (one tone file, so "weak") |

## 3. Files

### `packages/voice` (additive)

| File | Change |
|---|---|
| `src/endpoint.ts` | **new**: `detectEndOfSpeech(samples, {silenceMs, maxMs})`, `FREE_TALK_SILENCE_MS = 800`, `FREE_TALK_MAX_MS = 8000` |
| `src/index.ts` | exports the above |
| `test/endpoint.test.ts` | **new**, 7 tests |

### `apps/mobile`

**Dependencies and config:**

| File | Change |
|---|---|
| `package.json` | `expo-audio ~57.0.5` (`npx expo install`, part of Expo Go), `@dsa/voice` |
| `app.json` | `["expo-audio", {microphonePermission: "DSA utilise le micro pour jouer à voix haute.", recordAudioAndroid: true, enableBackgroundRecording: false}]`. `expo install` also re-indented two short arrays (cosmetic). |
| `locales/fr.json` | `NSMicrophoneUsageDescription` (same text) |
| `jest.setup.ts` | `expo-audio` mock (voice tests replace the recorder itself) |
| `README.md` | "Voice" section, layout |
| root `package-lock.json` | expo-audio and the workspace link |

**Speech (`src/speech/`):**

| File | Contents |
|---|---|
| `recorder-types.ts` | **new**: `Recorder` interface (`supported`, `requestPermission`, `start(onSample)`, `stop() → Recording`, `cancel`); `Recording {audio: {kind:'file',uri} \| {kind:'blob',blob}, mimeType, fileName, durationMs, envelope}`; `RecorderError` codes `PERMISSION_DENIED \| UNAVAILABLE \| FAILED` |
| `recorder.native.ts` | **new**: `useRecorder()` on expo-audio. HIGH_QUALITY preset in mono at 64 kbit/s with metering (`.m4a`, sent as `audio/m4a`). `getStatus()` is polled every 50 ms with `tMs = durationMillis`. Permission: `getRecordingPermissionsAsync` then `requestRecordingPermissionsAsync`. `setAudioModeAsync({allowsRecording: true, playsInSilentMode: true})` while recording, `allowsRecording: false` after. |
| `recorder.web.ts` | **new**: `useRecorder()` with `getUserMedia` (echo cancellation and noise suppression on, auto gain **off**, so the envelope keeps its shape). `MediaRecorder` prefers webm/opus, then mp4, then ogg. An `AnalyserNode` gives RMS → `rmsToDb` every 50 ms. The AudioContext is created before the first await (autoplay rules). The stream is closed after each take. Errors map `NotAllowedError` → PERMISSION_DENIED and `NotFoundError` → UNAVAILABLE. |
| `recorder.ts` | **new**: the fallback TypeScript reads (unsupported). Metro picks `.native`/`.web`. |
| `transcriber.ts` | **new**: `createTranscribeClient<Recording>` with the player's access token (`ensureSignedIn`). Web appends a Blob; native appends `{uri, name, type}`. Without Supabase config it throws `DSA_VOICE_NOT_CONFIGURED`. `setTranscriber` is the test seam. |
| `voice-settings.ts` | **new**: a small shared store (`useSyncExternalStore`) on AsyncStorage: `dsa.voice.talkMode` (HOLD default), `dsa.voice.calibration` (JSON, `parseCalibration`) and `dsa.voice.calibrationOffered` |
| `use-voice-capture.ts` | **new**: the talking gesture. HOLD records while pressed plus a **400 ms tail**. FREE: a tap starts it, and it stops through `detectEndOfSpeech` or on a second tap. Live `level` 0…1, TTS held back, cancelled when the turn ends or on unmount. |
| `use-voice-turn.ts` | **new**: capture → `transcribe` → `onTranscript`. Handles "J'ai entendu", the notice line and the fallbacks. Recordings under 250 ms are not sent. |
| `interpret.ts` | **new**, pure: `interpretDecouvreur` (matchIntent, DECOUVREUR, `knownNames`, path) and `interpretTireur` (decideAnswer; name call = OUI/NON only). `soundVerdict` is the calibration live test. |
| `use-speech.tsx` | `setListening(bool)`: stops TTS, holds back what is asked meanwhile, and speaks the last one after |
| `stt.ts` | **deleted** (S3's placeholder interface, unused) |

**Views, components, screens:**

| File | Change |
|---|---|
| `src/views/voice-play.tsx` | **new**: `DecouvreurVoice` (ASK → `ask`, GUESS → `guess`, BACK → `goBack(step)` or the step list, UNKNOWN → notice + TTS); `TireurVoice` (ANSWER → `answer`/`confirmGuess`, CONFIRM → two full-width slabs, REWIND → `rewind`); `VoicePanel` (fallback banner, button, hint, heard, notice, talk mode) |
| `src/views/calibration-panel.tsx` | **new**: `CalibrationPanel` (intro → OUI ×2 → OUIIII ×2 → result + live test), `CalibrationSummary`, `CalibrationSheet`, `CalibrationOffer` (first time / LOCAL) |
| `src/components/voice-button.tsx` | **new**: `VoiceButton` (states prêt / écoute with a 12-bar meter / analyse / not your turn), `TalkModeChips` |
| `src/views/decouvreur-view.tsx` | voice panel below the turn card. TTS uses `speakableAnswer` / `speakablePrompt`. With Voix only the answer is spoken (deviation 1). Dedupe is keyed by exchange (bug fix). |
| `src/views/tireur-view.tsx` | calibration offer and sheet. One `TireurVoice` for the whole game, between the incoming question and the pad. TTS: `speakablePrompt(prompt)`, `speakableName(name) + " ?"`. |
| `src/views/tireur-ready-view.tsx` | "Calibrer pour ce Tireur" (LOCAL) / the first-time offer (rooms), and the sheet |
| `app/jouer/index.tsx` | "Voix" is selectable (solo and room creation; the creator's choice is S6's `settings.input_mode` for both phones) |
| `app/voix.tsx` | **new**: "Réglages de la voix" (talk mode, calibration summary, redo, clear) |
| `app/index.tsx` | link "Réglages de la voix" |
| `app/resultat/[sessionId].tsx` | "C'est Abram !" uses `speakableName` |
| `src/components/index.ts` | exports |
| `src/i18n/fr.ts` | `voice` section (every new string; no "Est-ce") |

**Tests:** `voice-interpret.test.ts`, `voice-play.test.tsx`, `voice-calibration.test.tsx`, `voice-rooms-phrasing.test.tsx` (+ `__snapshots__/`), helpers `fake-recorder.ts` and `voice-harness.tsx`; `question-phrasing.test.tsx` updated.

## 4. Manual phone checklist (owner)

**Before you start:**
- `transcribe` is deployed and the curl in `VOICE.md` §5 works.
- `apps/mobile/.env` has the real Supabase URL and key (`EXPO_PUBLIC_DSA_GRAPH_SLUG=mini` is fine for a quick test).
- Run `cd apps/mobile && npx expo start --clear` and open the app in **Expo Go** on an Android phone and an iPhone.
- Sound on, volume up.

### A. Permission and fallbacks (each phone)
1. Accueil → Jouer → "Je suis le Découvreur" → **Façon de jouer : Voix** → Commencer.
   - [ ] "Voix" can be selected.
2. Hold the mic button.
   - [ ] The system asks for the microphone **in French** ("DSA utilise le micro pour jouer à voix haute.").
   - Refuse.
   - [ ] Banner "Le micro est refusé…", the mic disappears, and **Poser la question** still works.
3. Allow the microphone in the phone settings, start a new game.
   - [ ] The mic is back.
4. Airplane mode, then hold and say "Ancien".
   - [ ] Banner with "Pas de connexion au serveur vocal…"; the buttons still work.
   - Airplane mode off: [ ] the next try works.

### B. Découvreur by voice (AI Tireur), in a quiet room, then a noisy one (TV or music on)
1. **Hold** the button, say "Ancien", release.
   - [ ] The label shows "Je t'écoute…" with a moving level meter while you speak.
   - [ ] Then "J'analyse…".
   - [ ] Then "J'ai entendu : « Ancien »", and the phone says **"Oui."** out loud, at normal volume (iPhone: from the speaker, not the earpiece).
2. Say the next question as shown ("Homme").
   - [ ] It's asked; the answer is spoken.
3. Say something else ("banane").
   - [ ] "Je n'ai pas bien compris. Peux-tu répéter ?" is shown **and spoken**.
4. Say a name, for example "Caïn !".
   - [ ] "Tu as proposé CAÏN", then OUI or NON.
5. Say "revenir à Ancien".
   - [ ] The game goes back to that question.
   - Say just "revenir": [ ] the question list opens.
6. Switch to **Parler librement**, tap once, say "Pentateuque", stay silent.
   - [ ] It stops by itself about 1 s after you stop talking.
   - Tap and say nothing: [ ] it stops after 8 s.
7. The phone must not hear itself.
   - [ ] While the phone is speaking, pressing the mic stops the phone's voice at once.

### C. Tireur by voice (AI Découvreur) and calibration
1. Jouer → "Je suis le Tireur" → Voix → Commencer.
   - [ ] "Régler ta voix ?" appears once. Tap **Régler ma voix**.
2. "Dis OUI normalement" ×2, then "Dis OUIIII en le tenant longtemps" ×2.
   - [ ] The instructions are spoken.
   - [ ] The result shows your OUI (~0,3 s), your OUIIII (~1 s) and the limit.
   - Live test: [ ] a plain "oui" → "J'ai compris : OUI"; a long "ouiiii" → "J'ai compris : OUI OUI OUI".
   - Terminé.
3. **The questions are spoken directly:**
   - [ ] "Ancien ?", "Homme ?" — never "Est-ce…".
   - [ ] "Lié à …" is pronounced with accents.
4. **Answer by voice at each question:**
   - [ ] "oui" → the next question comes;
   - [ ] at PENTATEUQUE (or LIVRE DE SAMUEL), a **long** "nonnnn" / "ouiiii" takes the repeated branch;
   - [ ] a plain one takes the simple branch;
   - [ ] something in between → "Tu as dit lequel ?" with two big buttons.
5. Say **"question question"**.
   - [ ] It goes back two questions.
6. When the app calls a name, say "non" (or "oui" if it is the card's name).
   - [ ] The call is answered: the game continues, or the result screen opens.
7. While the app is choosing its question:
   - [ ] the mic reads "Le micro s'allume à ton tour." and can't be pressed.
8. [ ] The OUI / NON (and other) buttons stay visible the whole time.
9. Accueil → **Réglages de la voix**.
   - [ ] The measured values are shown; "Refaire le réglage" works.
   - [ ] Close and reopen Expo Go: the values are still there.

### D. LOCAL (one phone)
1. Jouer → "Deux joueurs sur ce téléphone" → Voix.
   - [ ] In "Regarde ta carte": **"Calibrer pour ce Tireur"** is there even if the phone was already calibrated; it opens the calibration.
2. Play a few turns, passing the phone.
   - [ ] Each player can speak on their turn.
   - [ ] The Découvreur hears the answer after the phone is passed.

### E. Rooms (two phones, S6 checklist first)
1. Phone A creates a room with **Voix**.
   - [ ] Phone B's lobby shows "Façon de jouer : Voix".
2. B asks "Ancien" by voice.
   - [ ] **A speaks "Ancien ?"** when it arrives.
   - A answers by voice.
   - [ ] **B speaks "Oui."** when it arrives.
3. [ ] On each phone the mic is only enabled on that phone's turn.

### F. Web
1. On the Vercel address, in Chrome (Android or desktop) and Safari (iPhone), play one game as Découvreur with Voix.
   - [ ] The browser asks for the microphone.
   - [ ] Hold to talk works with a finger or a mouse (no text selection or context menu while holding).
   - [ ] "J'ai entendu" appears.
2. iPhone Safari:
   - [ ] recording works (Safari records `audio/mp4`, which the function accepts).

## 5. Deviations and decisions

1. **With Voix, the Découvreur's phone speaks only the answer, not the next question.** In Buttons mode it still says "Oui. Homme ?". With Voix the Découvreur says the question, so the phone answering like the person across the table ("Ancien ?" → "Oui.") matches the brief's goal and avoids the phone prompting what the player is about to say. The next question stays on screen. A dead end is still spoken. *Owner to confirm* (open question 1).
2. **TTS uses the speakable forms everywhere, Buttons mode included:** `speakablePrompt`, `speakableAnswer`, `speakableName` (§10). S3b's `question-phrasing` test was updated from "HOMME ?" to "Homme ?" for TTS; the screen is unchanged.
3. **The recorder is a hook, `useRecorder(): Recorder`,** in `recorder.native.ts` / `recorder.web.ts`, because expo-audio's recorder is created by `useAudioRecorder`. The shared types live in `recorder-types.ts`, and `recorder.ts` is only the fallback TypeScript reads.
4. **`detectEndOfSpeech` was added to `packages/voice`** (pure, tested) instead of being written in the app. It uses the same noise floor and hysteresis as `analyzeEnvelope`.
5. **Calibration details:**
   - The live test uses only the sound (`classifySound`), with nothing sent to `transcribe`, so it costs no quota and works offline. Several bursts count as a repeated OUI there.
   - A take with no detected voice is asked again.
   - A `weak` result is saved anyway, with the "se ressemblent" warning and "Refaire le réglage".
   - The calibration uses the chosen talk mode.
   - "Offered the first time" is remembered on the device, whether the player chose "Plus tard" or calibrated.
   - Rooms get the offer in the ready phase; AI Découvreur games get it on the Tireur view (they have no ready phase).
6. **Hold to talk:**
   - It records **400 ms after release**, because the envelope needs quiet frames for the noise floor.
   - Recordings **under 250 ms** are not sent ("Garde le bouton appuyé pendant que tu parles.").
7. **Name calls by voice:** the Tireur's answer is limited to OUI/NON (`decideAnswer` with `['OUI','NON']`), and "question" is ignored while a name waits (the engine forbids a rewind in GUESS_CONFIRM).
8. **The Découvreur's words must match the current question.** Saying a different book label ("Homme ?" while the book asks ANCIEN) is UNKNOWN, not an error from the server. "revenir" with no recognisable question opens the "Revenir à une question" list.
9. **How fallbacks behave:**
   - A refused microphone or no microphone hides the mic for the rest of that screen, and the banner can be closed.
   - `DSA_VOICE_NOT_CONFIGURED` also hides it.
   - Network, rate limit, provider and internal errors show the server's `message_fr` and keep the mic for a retry.
   - Each voice panel is mounted once per game view, so a fallback isn't asked again every turn.
10. **Audio session:** after each recording, `allowsRecording` is set back to false. On iOS a play-and-record session sends TTS to the earpiece, where nobody at the table would hear it. This needs the phone check (C.1).
11. **Recording format:** mono at 64 kbit/s (an 8 s take is about 64 kB, far under the 1.5 MB limit) instead of the preset's stereo 128 kbit/s. Web: auto gain control is off, so the loudness envelope keeps its shape.
12. **Bug fixed in `DecouvreurView`:** the spoken line was deduplicated by its text, so a second identical answer ("Oui." then "Oui.") was never spoken. It is now keyed by the exchange, which the snapshot test pins.
13. **"Réglages de la voix" is a new screen (`/voix`)** linked from Accueil, because there was no settings screen for "available again from the settings".
14. **LOCAL with Voix keeps S3b's hand-over screens.** Voice replaces taps, not the privacy of the card.
15. **In the offline demo (`EXPO_PUBLIC_DSA_OFFLINE=1`)** voice still needs the Supabase URL for `transcribe`. Without it the mic shows the "not configured" banner.
16. **Removed a stray file:** a root `tsconfig.json` (Expo's generated stub, created by `npx expo install`).

## 6. Open questions

1. **Deviation 1:** with Voix, should the Découvreur's phone also read the next question aloud (useful for a player who doesn't read), or only answer (feels like a person)? It is one line to change.
2. **Where the mic sits on the Découvreur's screen.** It is below the question card (screenshot 06), and on a small phone "J'ai entendu" can be below the fold. Should the mic move inside the "Question suivante" card when Voix is on?
3. **Android metering scale.** The analysis is relative to each recording's noise floor, so different dB scales on Android and iOS should be fine. If calibration on Android gives odd values (for example a very long OUI), check `MIN_NOISE_FLOOR_DB` (−70) against the phone's quiet level.
4. **The hint's names.** With the book's 1,209 names, `buildTranscribeHint` sends the first 40 in list order (after any named on screen), which is almost always alphabetical. Whisper's prompt is too small for all of them. Is there a better "likely names" order? The Découvreur must not learn anything from it.
5. **`p_spoken_label`** (S3 §5.6, S7a open question 4): the transcript is available but not recorded; it needs an SQL change.
6. **S9 overlap:** S9 adds `timed` to `settings` and a thinking phase. Voice doesn't need the clock, but with the timer, transcription time (~1 s) counts against play time.
7. **In `.env`, not the repo:** the local `apps/mobile/.env` (gitignored) still has a comment naming the graph's old slug. Worth updating to `livre`, as `.env.example` already is.

## 7. Notes for S7c (live voice between phones)

**Who owns the microphone, and when:**
- **Today (S7b):** the mic is opened only by `useVoiceCapture`, only while the player holds the button (or free talk is running), and only on that player's turn. It is released right after:
  - **native:** expo-audio stops, and `setAudioModeAsync({allowsRecording: false})`;
  - **web:** the `MediaStream` tracks are stopped and the AudioContext is closed.
  `useSpeech().setListening(true)` silences TTS for that time.
- **With a WebRTC call, the call owns the microphone for the whole game.** On native, `react-native-webrtc` opens its own capture, and expo-audio can't record at the same time (Android allows one capture client; iOS shares one audio session, whose category the call needs as play-and-record with voice chat mode). So in a call:
  1. **Don't open expo-audio.** Record the voice turn from the call's local audio track instead: on the web, a `MediaRecorder` + `AnalyserNode` on `localStream` (the same code as `recorder.web.ts`, minus `getUserMedia`); on native, `react-native-webrtc` has no recorder, so either add a native recorder of the track or **pause the call's sending track (`track.enabled = false` for the other phone) and fall back to expo-audio for that turn only**. Measure the switching latency on a phone before choosing.
  2. **Put the choice behind the `Recorder` interface.** Add a `useCallRecorder(localStream)` implementing `Recorder`, and have `useVoiceCapture` take the recorder from context instead of calling `useRecorder()` directly. Nothing else in the voice pipeline changes.
  3. **Echo:** the call's echo cancellation handles the other phone's voice. TTS should still be held back while recording (`setListening`), and TTS during a call must go through the call's audio route (on iOS, `playAndRecord` + `voiceChat`, not `allowsRecording: false`). **Remove the `setRecordingMode(false)` after recording while a call is active**, or it will break the call's session.
  4. **Turn-taking stays the same:** only the player whose turn it is may record a voice command. The call carries both voices all the time; commands are recognised only from the player's own recording on their own phone.
- **Rooms without a call** (Expo Go, no WebRTC) keep S7b's behaviour: each phone speaks the other's move (§2.2).
- `VoiceButton` and the fallbacks already cover "the call took the mic": map it to `RecorderError('UNAVAILABLE')` with a line like "Le micro est utilisé par l'appel", and the buttons remain.
