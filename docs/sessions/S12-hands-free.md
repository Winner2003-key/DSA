# Brief S12 — Hands-free, voice-first play (the owner's main goal)

You are a senior React Native / Expo engineer with audio and conversational-interface experience, on **DSA — Découverte Sans Alphabet**. Repo: `/home/winner/projects/DSA`.

This session implements backlog item **B5**. **The goal:** digitize the experience of playing with nothing but a piece of paper with the name on it. Once the game is set up, the two players **only talk**. Neither should need to look at or touch the screen unless something goes wrong.

**Start after S7c (live voice between phones), and run alone:** S9, S10, S11 and this session all change `apps/mobile`. Check `git status` first.

## Read first
1. **`docs/sessions/CONTEXT.md`** — where the project stands. It replaces the old reports.
2. **`docs/sessions/CHECKS.md`** — what to run and when. Follow it.
3. `docs/sessions/README.md`: the global rules.
4. `GAME_RULES.md` (all — it is short) and `GRAPH_SPECIFICATION.md` §1 (speech and answer
   recognition), §8, §9, §10.
5. **`docs/sessions/BACKLOG.md`: B5**, and B3 if a recorded or cloud voice has been chosen by then.
6. **The code, not the reports:** `packages/voice/src/**`, `apps/mobile/src/speech/**`,
   `packages/core/src/intents.ts`. That is where the recorder, transcriber, intents and
   calibration actually live.
7. **One section from one report:** who owns the microphone during a call, in
   `S7c-live-voice.md`. It decides a lot here.

**Don't read the other reports end to end, and don't open the old screenshot folders.**

## You own
`apps/mobile/**`; additive changes in `packages/voice` and `packages/core` (intents) with tests. No SQL is expected; if you need a server change, say so in the report instead of inventing one.

## Deliver

### 1. Automatic turn-taking listening
- When it's this player's turn, the phone **listens by itself**: no hold, no tap. It detects the end of speech (silence for ~700 ms, maximum ~8 s) and sends it.
- A short, distinct **sound cue** marks "à toi" and "j'écoute", so a player with the phone face down knows when to speak.
- The microphone is never open on the other player's turn, and never while the phone is speaking (stop TTS first, S7b).
- A **« Mains libres »** switch in Réglages (S10), on by default when the game's input mode is Voix. Hold-to-talk stays available for noisy places.

### 2. Everything is spoken, in both directions
- **Découvreur:** hears the answer, then the next question is theirs to say; after a name call, hears OUI or NON.
- **Tireur:** hears the question, and the name call ("Le Découvreur propose ABSALOM").
- **Misunderstood:** "Je n'ai pas bien compris, répète" (spoken), after two failures a spoken hint of the expected question.
- **Held OUI, borderline (§1):** resolve it **by voice** — "Oui simple ou oui long ?" — and only fall back to the two buttons if that fails too.
- **Timer (S9):** spoken warnings, "Plus que trente secondes", "Plus que dix secondes", and "Temps écoulé".
- **End:** the discovery announced aloud ("Trouvé ! ABSALOM"), then a spoken invitation to look at the screen for the book's path.
- **Spoken commands, in French:** "Répète" (say the last thing again), "Pause" / "Reprends", "Abandonner" (asks for confirmation out loud), "Change de nom" (Tireur, before the start, S9), "Reviens" / "Question" as today.

### 3. The screen becomes a mirror
- A **« Mode mains libres »** layout: very large current state (whose turn, the last thing said, the last answer), no small controls, readable from across a table; a single visible escape ("Toucher pour reprendre la main").
- Everything the app says appears as text too (accessibility and noisy rooms).
- The game must be **finishable with the phone face down**: no step may require a tap. Prove it in a test.

### 4. Robustness
- Background noise and speech that isn't for the game are ignored rather than acted on.
- The phone never treats its own speech as an answer (echo guard).
- Both players talking at once: only the phone whose turn it is acts.
- A dropped network during a turn: a spoken "Connexion perdue", then a spoken resume.
- With live voice between phones (S7c), each phone only acts on **its own** player's speech; follow S7c's microphone decision exactly.

## Tests and verification (see `CHECKS.md`; summary lines only)
- while you work, run only the suite you touched; **once at the end**, core, voice and mobile
  `npm test` / `typecheck` and `npx expo export -p web` (no `--clear`). `expo-doctor` only if
  you change `package.json`.
- **A full game with zero taps** after the setup screen, driven by a fake recorder and transcriber, in AI_TIREUR and in LOCAL: ask, answer, a wrong name call, a rewind, then discovery. The test asserts no `Pressable` was pressed.
- Silence, noise-only input, and an unrelated sentence → the spoken "je n'ai pas bien compris" path, not a wrong action.
- The borderline held-OUI resolved by voice.
- Spoken commands: "répète", "pause" then "reprends", "abandonner" with confirmation.
- Echo guard: a transcript that equals what the app just said is ignored.
- A browser run with a fake microphone playing generated sounds, as S7b did.
- Screenshots: the committed harness `tools/screens/` — don't build one. **6 shots maximum**,
  light theme, scale 1, into `docs/sessions/reports/S12-screens/`, each described in a sentence.
  The hands-free mirror layout is the one that matters.
- A **manual two-phone checklist** for the owner: a full game with both phones face down, in a quiet room and a noisy one.

## Report
Write `docs/sessions/reports/S12-hands-free.md`, **under 1,500 words**, with what it feels like to play this way, the timings chosen (silence, maximums, cues), files and outputs, the manual checklist, deviations and open questions.
