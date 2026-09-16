# Brief S7b — Voice in the app: speak to play (Expo Go and web)

You are a senior React Native / Expo engineer with audio experience, on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game. The goal of this session is that **playing feels like sitting with another person**: you say "Ancien ?", you hear "Oui."

**Start only after S3b, S6 and S7a are finished**, and after the owner has deployed the `transcribe` function (VOICE.md).

## Read first, completely
1. `docs/sessions/README.md`; `GAME_RULES.md` (**"How questions are said"**)
2. `GRAPH_SPECIFICATION.md`, especially §1 (speech and **answer recognition**), §7, §8 (`settings.input_mode`) and **§10**
3. Reports: `S3-expo.md` §7, `S3b-game-ux.md`, `S6-rooms.md`, **`S7a-voice.md`**; plus `VOICE.md`
4. `packages/voice/src/index.ts`, `packages/core/src/intents.ts`

## You own
`apps/mobile/**`; small additive changes in `packages/voice` if needed, with tests.

## Deliver
1. **Recording layer** (`src/speech/recorder.native.ts` / `.web.ts`, one `Recorder` interface):
   - **Native:** `expo-audio` (included in Expo Go) with metering enabled. **Check the current SDK 57 API in the Expo docs with WebFetch** (recorder hook, presets, metering status polling). Collect the `{tMs, db}` envelope every ~50 ms, and produce an m4a file.
   - **Web:** `getUserMedia` + `MediaRecorder` (webm/ogg) + an `AnalyserNode` RMS envelope in dB.
   - **Microphone permission:** the `expo-audio` config plugin with French text ("DSA utilise le micro pour jouer à voix haute."), and iOS `NSMicrophoneUsageDescription` in `locales/fr.json`.
   - **Stop TTS before recording** (otherwise the mic hears the phone).
2. **Talking UX:**
   - **Maintenir pour parler** (hold to talk) is the default, because it's the most reliable in a noisy room;
   - an option **Parler librement**: tap once, auto-stop after 800 ms of silence, max 8 s;
   - states: prêt, écoute (live level meter), analyse, then "J'ai entendu : « Ancien »";
   - the mic is only active on **your turn**.
3. **Découvreur by voice:**
   - the audio goes to `transcribe` with `buildTranscribeHint`, then `matchIntent` (role DECOUVREUR, `knownNames` from `dsa_list_names`);
   - **ASK** → `dsa_ask`; **GUESS** → `dsa_guess`; **BACK** → `dsa_go_back` (fuzzy match against the path, for example "revenir à Pentateuque");
   - **UNKNOWN** → spoken and shown: "Je n'ai pas bien compris. Peux-tu répéter ?";
   - the answer is then **spoken** to the Découvreur ("Oui." / "Ouiiii !" …), using `speakableAnswer`.
4. **Tireur by voice:**
   - the incoming question is **spoken as the direct label** (`speakablePrompt`: "Ancien ?", never "Est-ce …");
   - the Tireur answers out loud → `decideAnswer` (with the envelope from the recorder and the calibration);
   - **ANSWER** → `dsa_answer(canonical label)`; **CONFIRM** → two big buttons ("OUI" / "OUI OUI OUI") for one tap; **REWIND** → `dsa_rewind`; name calls → OUI/NON;
   - **the answer buttons stay visible at all times.**
5. **Calibration screen** (§1):
   - "Dis **OUI** normalement", 2 takes; "Dis **OUIIII** en le tenant longtemps", 2 takes; then a live test ("Dis l'un ou l'autre" → "J'ai compris : OUI OUI OUI");
   - measured values are shown simply, and stored per device in AsyncStorage;
   - offered the first time someone plays Tireur with Voix, and available again from the settings;
   - LOCAL: offer "Calibrer pour ce Tireur" at the start.
6. **Turn Voix on:**
   - "Façon de jouer: Voix" becomes selectable in "Préparer la partie" and in room creation. In rooms, the creator's choice applies to both players (S6).
   - **Fallback:** permission denied, function unreachable or rate limited → a French banner, and the game continues with buttons without leaving the screen.
7. **AI modes by voice:**
   - AI Tireur: its answers are spoken;
   - AI Découvreur: its questions are spoken directly ("Ancien ?"), and the human Tireur answers by voice.
8. **Rooms by voice, before S7c:** each device speaks the other player's action aloud (the question on the Tireur's device, the answer on the Découvreur's device), so a room is playable by voice even without live audio between the phones.

## Tests and verification (paste the output)
- mobile and voice `npm test` / `typecheck`; `expo-doctor`; `npx expo export -p web --clear`;
- unit and integration tests with a mocked recorder and a mocked transcribe:
  - "Ancien" → ask; "Absalom !" → guess; "revenir à Pentateuque" → back; noise → UNKNOWN message;
  - Tireur: long envelope + "oui" → OUIOUIOUI; short envelope → OUI; borderline → the confirm buttons;
  - "question question" → rewind(2);
  - permission denied → buttons, no crash;
- a snapshot test that no UI string or TTS utterance contains "Est-ce";
- a **manual phone checklist** for the owner (Expo Go, Android and iPhone; noisy room; calibration; each mode).

## Report
Write `docs/sessions/reports/S7b-voice-app.md` with files, outputs, the manual checklist, deviations, open questions, and notes for S7c (how the live voice call must coexist with recording: who owns the microphone, and when).
