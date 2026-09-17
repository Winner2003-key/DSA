# Brief S10 — Icons, a Réglages screen, voice choice and speed, and admin-editable pronunciation

You are a senior React Native / Expo engineer and product designer, comfortable with Next.js and PostgreSQL, on **DSA — Découverte Sans Alphabet**, a French Bible-name discovery game played by voice or buttons. Repo: `/home/winner/projects/DSA`.

This session implements backlog items **B2, B4, B3 (device voices) and B6** from `docs/sessions/BACKLOG.md`.

**Run one app session at a time:** S9 (timer), S10 and S11 all change `apps/mobile`. Check `git status` at the start; if another session's work is uncommitted, stop and tell the owner.

## Read first, completely
1. `docs/sessions/README.md`: global rules. **No Docker**, no commit, French UI. **Public repo: never write the source book's title, author or organisation.**
2. `GAME_RULES.md`; `GRAPH_SPECIFICATION.md` §1 (speech, answer recognition), §8, §10 (direct phrasing, pronunciation lexicon).
3. **`docs/sessions/BACKLOG.md`: B2, B3, B4, B6.**
4. Reports: `S3-expo.md`, `S3b-game-ux.md` (design language, components), **`S7b-voice-app.md`** (recorder, transcriber, calibration, voice views), `S6-rooms.md` (lobby and room screens), `S5-admin.md` and `S5b-admin-homonyms.md` (admin structure), `S2-database.md` (verifying SQL without Docker).
5. `packages/voice/src/{speakable,lexicon.fr}.ts`, `apps/mobile/src/speech/**`, `apps/mobile/src/theme/**`, `apps/mobile/src/i18n/fr.ts`.

## You own
- `apps/mobile/**`;
- `apps/admin/**` (a new Prononciation page and its link);
- `supabase/`: a migration with **the next free number** (check `ls supabase/migrations`), a matching `sql-editor/NN_pronunciation.sql`, the regenerated `00_all_migrations.sql`, additions to `90_tests.sql`, and `DATABASE_SCHEMA.md`;
- `packages/voice`: additive (applying pronunciation overrides), with tests.

## Deliver

### 1. Icons instead of text-heavy buttons (B2)
- Inventory every button in the app first, and list in your report which became icon-only, which keep icon + label, and why.
- Use `@expo/vector-icons` (included in Expo Go). Suggested mapping: microphone, back arrow ("Revenir à une question"), rewind ("QUESTION"), flip or eye (show/hide card), share, QR, gear (Réglages), replay ("Rejouer l'animation"), exit ("Abandonner"), speaker / speaker-off (mute), timer.
- **Rules:** every icon-only control has an `accessibilityLabel` and a `hitSlop` reaching ≥56 pt; the primary actions of a turn (**Poser la question**, the answer pad OUI / NON / …) **keep their words**, because they're the game's vocabulary; an icon whose meaning isn't obvious keeps a short label under it.
- Add a test that fails when an icon-only `Pressable` has no `accessibilityLabel`.

### 2. A Réglages screen in the app (B4)
- Route `app/reglages.tsx`, reachable from the home screen (gear) and from the game screen's menu.
- Stored **per device** (AsyncStorage) in a typed store with sensible defaults and one migration-safe version field:
  - **Voix:** voice choice with **Écouter** preview, male / female where the device exposes it, **speed** (0.6× to 2.0×, with a "très rapide" marker), pitch, mute, and **"Refaire la calibration"** (the held-OUI calibration from S7b).
  - **Jeu (defaults for "Préparer la partie"):** Voix or Boutons, timer on/off (has no effect until S9 lands; if S9 is already in, wire it), player display name.
  - **Confort:** theme (clair / sombre / automatique), text size (normal / grand), haptics, sounds, reduced motion follows the system but can be forced.
- Everything applies immediately, and "Préparer la partie" starts from these defaults.
- A **"Réinitialiser les réglages"** button with confirmation.

### 3. Device voices, male or female, and speed (B3, device part only)
- `apps/mobile/src/speech/voices.ts`: list the device's French voices (`Speech.getAvailableVoicesAsync()` on native, `speechSynthesis.getVoices()` on web, which needs the `voiceschanged` event), keep `fr-*`, and expose `{ id, label, locale, quality, gender: 'M'|'F'|null }`.
  - Gender comes from the platform field when present, otherwise from a small, documented name list; never guess silently, and show "voix 1 / voix 2" when unknown.
  - **Accent:** prefer a voice whose locale is African French (`fr-CM`, `fr-SN`, `fr-CI`, `fr-BJ`, `fr-TG`, `fr-BF`, `fr-ML`, `fr-CD`, …) when the device has one, and mark it in the list. **Report which `fr-*` voices actually exist** on the machines you can test (web browsers, and the owner's phones through the checklist), so the owner can decide about a cloud or recorded voice later. **Don't add a cloud provider in this session.**
- The chosen voice, speed and pitch are used by every spoken line (`useSpeech`), including the AI Découvreur's questions and the spoken answers.
- If the device has no French voice: a clear French notice in Réglages, and the game keeps working with buttons.

### 4. Admin-editable pronunciation (B6)
- **SQL:** table `pronunciations` — `id`, `graph_id` (nullable: null means "all graphs"), `term`, `term_normalized` (generated from `dsa_normalize`), `spoken_form`, `note`, `updated_by`, `updated_at`; unique on `(graph_id, term_normalized)`; RLS: admins full CRUD, nobody else writes.
  - RPC `dsa_list_pronunciations(p_graph_slug text)` → `(term, spoken_form)` rows only, granted to `authenticated`. It exposes no graph structure, no clues and no secrets.
  - Tests: admin can write and a player can't; the RPC returns only the two columns; anon is refused; graph-specific rows win over global ones.
- **Admin page `/graphes/[slug]/prononciation`:** search the graph's names and question labels, show the current spoken form, edit it, press **Écouter** (browser `speechSynthesis`, with the same voice and speed controls as the app so the admin hears what players hear), and save. Show which terms already have an override, and a filter for "sans prononciation". Link it from the graphs list, the editor header and the Homonymes page.
- **App:** fetch the list once per session (cache it, refresh on app start), and apply it in `packages/voice` `speakablePrompt` / `speakableAnswer` **above** the built-in lexicon: an exact normalized match on the whole label, or on a word inside it. The screen always shows the book's spelling.
- A player-facing note isn't needed; this is silent.

## Tests and verification (paste the output)
- `npm test` and `npm run typecheck` for `packages/core`, `packages/voice`, `apps/mobile`, `apps/admin`; `npm run build --workspace apps/admin`; `npx expo-doctor`; `npx expo export -p web --clear`.
- New tests:
  - the accessibility rule for icon-only buttons;
  - the settings store: defaults, persistence, reset, and "Préparer la partie" reading them;
  - voice listing and selection with a fake voice list, including "no French voice" and an African locale being preferred and marked;
  - speed applied to a spoken line;
  - pronunciation overrides applied in `speakablePrompt` (whole label and single word), graph-specific beating global, and no effect on displayed text;
  - the admin page: search, edit, save diff, and the `dsa_list_pronunciations` shape.
- SQL verified like S2 (libpg-query plus PGlite in your scratchpad, not the repo), on a fresh database and on the owner's upgrade path.
- Headless screenshots into `docs/sessions/reports/S10-screens/`: the home screen with the gear, each Réglages section, the voice list with a preview, a game screen with the new icons (Tireur and Découvreur), and the admin Prononciation page.

## Report
Write `docs/sessions/reports/S10-app-experience.md` with:
- the icon inventory and the decisions;
- **which `fr-*` voices were found**, and a short recommendation for the African-accent question (device, cloud or recorded), with links and prices if you researched providers;
- files and outputs;
- **the exact SQL file to paste**;
- deviations and open questions.
