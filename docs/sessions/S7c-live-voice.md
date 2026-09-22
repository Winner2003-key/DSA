# Brief S7c — Live voice between two players (WebRTC)

You are a senior React Native engineer with WebRTC experience, on **DSA — Découverte Sans Alphabet**. Two people in a room should **hear each other live**, as if sitting at the same table, while the app still understands the game actions.

**Start only after S7b is finished.** Important: `react-native-webrtc` is native code, so **it does not run in Expo Go**. It needs an EAS **development build** or the **preview APK**. The web version uses the browser's WebRTC.

## Read first
1. **`docs/sessions/CONTEXT.md`** — where the project stands. It replaces the old reports.
2. **`docs/sessions/CHECKS.md`** — what to run and when. Follow it.
3. `docs/sessions/README.md`: the global rules.
4. `GRAPH_SPECIFICATION.md` §1, §3 (realtime and signaling) and §10 (credentials).
5. The **microphone-ownership** section of `S7b-voice-app.md` and the room-channel section of
   `S6-rooms.md` — those two sections only.
6. The current Expo docs for `expo-dev-client`, and the `@config-plugins/react-native-webrtc`
   compatibility table for SDK 57. **Check with WebFetch.**
**Don't read the old reports end to end, and don't open the old screenshot folders.** If you
need one decision's reasoning, read that report's §1 Files table or search it for the term.


## You own
`apps/mobile/**`; `supabase/functions/turn-credentials/**` (optional, see step 4); `VOICE.md` (add a "Voix en direct" section).

## Deliver
1. **Research spike first (write the decision into the report before building):** the microphone is shared between the live call and the game's speech recognition.
   - On web, one `getUserMedia` stream can feed both `RTCPeerConnection` and `MediaRecorder`.
   - On Android and iOS, check whether `react-native-webrtc` and `expo-audio` can capture at the same time. If not, choose and document one of:
     - (a) on your turn, while you hold to talk, capture through a WebRTC-compatible path;
     - (b) briefly mute the call track while recording the game action, and let the other device speak the recognized action (S7b step 8);
     - (c) another approach that works.
   
   Pick what is **reliable on real devices**, not what is elegant.
2. **Platform layer:** `src/call/peer.native.ts` (react-native-webrtc) / `peer.web.ts` (browser) behind one `VoiceCall` interface.
   - **Native:** add `@config-plugins/react-native-webrtc` and `expo-dev-client`. Update `eas.json`: `development` (dev client APK) and `preview` (APK).
   - **Expo Go:** detect that the native module is missing, and show "La voix en direct nécessite l'application DSA installée (APK)". The game keeps working with S7b voice.
3. **Signaling:**
   - use the room's Realtime channel `room:<ROOM_CODE>` (already joined by S6) with broadcast events `offer`, `answer`, `ice`, `hangup`;
   - use the "perfect negotiation" pattern (the Découvreur is polite);
   - ignore messages that don't come from this room's two players.
4. **ICE servers:**
   - public STUN by default;
   - **TURN is optional but needed on many mobile networks.** Implement `supabase/functions/turn-credentials`, which returns **short-lived** TURN credentials from a provider the owner picks (document two options with free tiers, for example Cloudflare Realtime TURN and Metered, with the current terms and links). Secrets live only in Supabase, and the function requires the Supabase JWT.
   - If it isn't configured, the call uses STUN only and says so if it can't connect.
5. **Call UX (French):**
   - it connects automatically when both players are in the room and "Voix" was chosen;
   - big **Micro coupé / Micro ouvert** toggle, a "parle…" speaking indicator for both players (audio level), connection status (connexion…, connecté, reconnexion…, échec), ICE restart on network change, loudspeaker by default on phones, and hang up;
   - behaviour when the app goes to the background.
6. **EAS build instructions** for the owner: `npm install -g eas-cli`, `eas login`, `eas init`, `eas build -p android --profile development`, installing the APK, `npx expo start --dev-client`; then `eas build -p android --profile preview` for a shareable APK.

## Tests and verification (see `CHECKS.md`; summary lines only)
- while you work, run only the suites you touch; **once at the end** mobile `npm test` /
  `typecheck` and `npx expo export -p web` (no `--clear`). `expo-doctor` only if you change
  `package.json` — which this session probably does, so run it then;
- unit tests: the negotiation state machine (glare handling), signaling message filtering, the fallback when the native module is absent, and the TURN credentials function (mocked provider, no JWT → 401);
- **web-to-web call test** in two headless browser contexts with fake media devices, only if the owner agrees and `apps/mobile/.env` exists (graph `mini`; abandon the test sessions);
- a **manual checklist** for two Android phones (APK), phone ↔ web, the same Wi-Fi and two different networks (4G), with and without TURN.

## Report
Write `docs/sessions/reports/S7c-live-voice.md` with:
- the spike decision (step 1);
- files and outputs;
- **what the owner must do** (TURN provider account and secrets if wanted, the EAS build steps);
- the manual checklist;
- open questions.
