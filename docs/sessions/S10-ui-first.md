# Brief S10 — UI pass: icons, a Réglages screen, and voice choice (priority)

You are a senior React Native / Expo engineer and product designer on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game played by voice or buttons. Repo: `/home/winner/projects/DSA`.

**This is the owner's priority: the look and feel of the app comes before the remaining features.** This session is **app-only**: no SQL, no admin, no game-rule change.

Implements backlog items **B2** (icons), **B4** (Réglages screen) and **B3, device part** (voice choice, male/female, speed). B6 (admin pronunciation) is a separate brief for later.

**Run one app session at a time.** S11 (`S11-rules-and-practice.md`) also owns `apps/mobile`. At the start, run `git status`: if there are uncommitted changes in `apps/mobile`, `packages/core` or `supabase`, stop and tell the owner instead of working on top of them.

## Read first, completely
1. `docs/sessions/README.md`: global rules. **No Docker**, no git commit, French UI. **Public repo: never write the source book's title, author or organisation.**
2. `GAME_RULES.md` (how the game is played and said) and `GRAPH_SPECIFICATION.md` §1 (speech, answer recognition), §8 and §10.
3. **`docs/sessions/BACKLOG.md`: B2, B3, B4** (and B5, so your choices don't block hands-free play later).
4. Reports, for what exists and why: `S3-expo.md` (design language), `S3b-game-ux.md` (conversation view, path graph, game table), `S6-rooms.md` (lobby, room screens), `S7b-voice-app.md` (voice controls, calibration), `S9-timed-games.md` (countdown ring, preparation phase, "Changer de nom", result screen).
5. The screenshots in `docs/sessions/reports/S3b-screens/`, `S6-screens/`, `S7b-screens/` and `S9-screens/`.

## You own
`apps/mobile/**` only. Additive changes in `packages/voice` are allowed **only** if a voice helper genuinely belongs there, with tests. **Don't touch** `supabase/`, `apps/admin/`, `packages/core`, `scripts/` or the rule documents.

## Deliver

### 1. A UI pass over every screen (use the `frontend-design` skill)
Go through the screens in order — Accueil, Préparer la partie, Jouer avec un ami (create, join, lobby), the game table (Tireur and Découvreur), the preparation phase, the result screen, and the voice screens — and fix what makes them feel like a form rather than a game:
- one clear primary action per screen, and a visible hierarchy between it and the rest;
- less text: shorter labels, no repetition between a title and the button below it;
- consistent spacing, alignment and card shapes across screens (the S3 chalkboard-and-brass identity stays);
- loading, empty and error states that don't shift the layout;
- both themes checked, at 390 px, 430 px and on a tablet or desktop width;
- touch targets ≥56 pt, nothing important within reach of a mis-tap on the answer pad.

Write a short before/after note per screen in the report.

### 2. Icons instead of text-heavy buttons (B2)
- Inventory every button first; the report lists which became icon-only, which keep icon + label, and why.
- `@expo/vector-icons` (included in Expo Go). Suggested mapping: microphone, back arrow ("Revenir à une question"), rewind ("QUESTION"), flip or eye (show/hide the card), share, QR, gear (Réglages), replay ("Rejouer l'animation"), exit ("Abandonner"), speaker / speaker-off, timer, and the name-change icon (S9).
- **Rules:**
  - the game's own vocabulary keeps its words: **Poser la question**, **OUI / NON / OUI OUI OUI / NON NON NON / JE NE SAIS PAS**, **Proposer un nom**, **Je suis prêt**;
  - every icon-only control has an `accessibilityLabel` and a `hitSlop`;
  - an icon whose meaning isn't obvious keeps a small label underneath;
  - icons never carry meaning by colour alone.
- Add a test that fails when an icon-only pressable has no `accessibilityLabel`.

### 3. A Réglages screen (B4)
- Route `app/reglages.tsx`, reached from the Accueil (gear) and from the game screen's menu; a "Retour" that never loses a game in progress.
- Stored **per device** (AsyncStorage) in a typed store with defaults and a version field, applied immediately:
  - **Voix:** voice choice with an **Écouter** preview, male / female when the device says, **speed** 0.6×–2.0× with a "très rapide" marker, pitch, mute, and **"Refaire la calibration"** (the held-OUI calibration from S7b).
  - **Jeu (defaults for "Préparer la partie"):** Voix or Boutons, chronomètre on/off (S9), display name.
  - **Confort:** theme (clair / sombre / automatique), text size (normal / grand), haptics, sounds, and reduced motion (follow the system, with an override).
- "Préparer la partie" and room creation start from these defaults.
- **"Réinitialiser les réglages"** with confirmation.

### 4. Voice choice, male or female, and speed (B3, device part)
- `apps/mobile/src/speech/voices.ts`: list the device's French voices (`Speech.getAvailableVoicesAsync()` on native; `speechSynthesis.getVoices()` plus the `voiceschanged` event on web), keep `fr-*`, expose `{ id, label, locale, quality, gender: 'M'|'F'|null }`.
  - Gender from the platform field when present, otherwise a small documented name list; when unknown, label them "voix 1 / voix 2" rather than guessing.
  - **Accent:** when the device has an African French locale (`fr-CM`, `fr-SN`, `fr-CI`, `fr-BJ`, `fr-TG`, `fr-BF`, `fr-ML`, `fr-CD`…), list it first and mark it. **Report which `fr-*` voices actually exist** where you can test. **Don't add a cloud voice provider in this session.**
- The chosen voice, speed and pitch apply to every spoken line, including the AI Découvreur's questions and the spoken answers.
- No French voice on the device: a clear French notice in Réglages, and the game still works with buttons.

## Tests and verification (paste the output in the report)
- `npm test` and `npm run typecheck` for `apps/mobile` (and `packages/voice` if you touched it); `npx expo-doctor`; `npx expo export -p web --clear`.
- Every existing test keeps passing; adapt the ones whose labels you change rather than deleting them.
- New tests: the accessibility rule for icon-only buttons; the settings store (defaults, persistence, reset, "Préparer la partie" reading them); voice listing and selection with a fake list, including "no French voice" and an African locale being first and marked; speed applied to a spoken line.
- Headless screenshots (offline mode, both themes) into `docs/sessions/reports/S10-screens/`: Accueil, Réglages (each section), the voice list with a preview, Préparer la partie, the game table for both roles, the preparation phase, and the result screen.

## Report
Write `docs/sessions/reports/S10-ui-first.md` with:
- the before/after note per screen, and the icon inventory with decisions;
- **which `fr-*` voices were found**, and a short recommendation on the African-accent question (device, cloud or recorded voices) for the owner to decide later;
- files and outputs;
- deviations and open questions.
