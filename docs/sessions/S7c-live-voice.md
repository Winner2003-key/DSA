# Brief S7c — Live voice between two players (WebRTC)

You are a senior React Native engineer with WebRTC experience, on **DSA — Découverte Sans Alphabet**. Two people in a room should **hear each other live**, as if sitting at the same table, while the app still understands the game actions.

**Start only after S7b is finished.** Important: `react-native-webrtc` is native code, so **it does not run in Expo Go**. It needs an EAS **development build** or the **preview APK**. The web version uses the browser's WebRTC.

## Read first, completely
1. `docs/sessions/README.md`; `GAME_RULES.md`; `GRAPH_SPECIFICATION.md` (§1, §3 realtime and signaling, §10 credentials)
2. Reports: `S6-rooms.md` (the room channel), `S7a-voice.md`, **`S7b-voice-app.md`** (microphone ownership notes)
3. The current Expo docs for `expo-dev-client`, and the `@config-plugins/react-native-webrtc` compatibility table for SDK 57. **Check with WebFetch.**

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

## Tests and verification (paste the output)
- mobile `npm test` / `typecheck`; `expo-doctor`; `npx expo export -p web --clear`;
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
