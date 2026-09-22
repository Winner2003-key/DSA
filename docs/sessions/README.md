# Work sessions

The lead session (the project manager) writes one brief per work session. **Each work session is a separate Claude Code session the owner opens, so it can be watched live.**

## How to start a session (VS Code)

1. Open the Claude Code panel and start a **new conversation** (new tab), with the working directory `/home/winner/projects/DSA`.
2. Send: `Read docs/sessions/<BRIEF>.md and carry out that brief completely.`
3. When it finishes, the session writes `docs/sessions/reports/<ID>.md` (**under 1,500 words**).
   Tell the lead session "S1 finished" (or just come back), and it will read the report, update
   `CONTEXT.md` and prepare the next briefs.

Sessions in the same wave can run **at the same time**, because they own separate folders. Don't start a later wave until the lead has reviewed the earlier wave's reports.

## Global rules for every session

**Three files, in this order, before anything else:**

1. **`docs/sessions/CONTEXT.md`** — where the project stands, in 900 words. It replaces
   reading the previous sessions' reports. Read it instead of them.
2. **`docs/sessions/CHECKS.md`** — what to run and when. Following it is the difference
   between a twenty-minute session and a three-hour one.
3. **Your brief**, then only the *named* sections of `GAME_RULES.md` and
   `GRAPH_SPECIFICATION.md` it points you at. They are the contract.

Then:

- **No Docker. Never run `supabase start`, `db reset` or `test db`.** SQL is run by the owner in the Supabase dashboard.
- The PDF isn't in the repo, and must not be added.
- **The GitHub repo is public, and every push to `main` deploys to Vercel.** Never write the source book's title, author or organisation into any file. Never copy content from `data/` (the private transcription) or `DIGITIZATION_REPORT.md` into tracked files. Bible names are fine. The book graph's slug is `livre`.
- Only touch the folders your brief says you own. Don't git commit; the lead commits after review.
- The UI is French. Code and docs are in English.
- Finish by writing your report: what was done, the summary test lines, deviations from the
  spec, and open questions. **Keep it under 1,500 words** — the next session has to read it.

### Don't spend the session on the wrong things

Measured on 2026-09-22: the whole test suite is **34 seconds** and the web export is another
15. The cost of earlier sessions was elsewhere — rebuilding a screenshot harness from
scratch, reading a hundred old screenshots, re-verifying unchanged SQL, and running 233 tests
after every edit. `CHECKS.md` says what to do instead. In short:

- run only the workspace you changed while you work; the full sweep once, at the end;
- `tools/screens/` is the **committed** screenshot harness — don't build another;
- **at most 8 screenshots**, one theme, scale 1, and describe them in words;
- never hand-edit `supabase/sql-editor/00_all_migrations.sql`; run `build.sh`;
- don't open previous sessions' screenshot folders.

## Plan

| Wave | ID | Brief | Owns | Status / when to start |
|---|---|---|---|---|
| 1 | S1 | `S1-core-engine.md` | `packages/core/`, root `package-lock.json` | ✅ done, reviewed |
| 1 | S2 | `S2-database-sql.md` | `supabase/`, `DATABASE_SCHEMA.md` | ✅ done, reviewed |
| 1 | LEAD | book transcription | `data/book/` (gitignored, private) | ✅ done: 53 pages, 1,209 names |
| 2 | S3 | `S3-expo-app.md`: Expo app, French UI, local and AI modes, TTS | `apps/mobile/` | ✅ done, reviewed |
| 2 | S4 | `S4-importer.md`: importer, validator CLI, id salt | `scripts/`, small core additions | ✅ done, reviewed; book imported by the owner |
| 3 | S3b | `S3b-game-ux.md`: clearer Découvreur, book-like path graph, engaging UI, input-mode setting, LOCAL starts with Tireur, homonym-only descriptions, direct phrasing | `apps/mobile/`, SQL 0006 / `03_game_ux.sql`, additive core | ✅ done, reviewed |
| 3 | S7a | `S7a-voice-foundations.md`: `packages/voice` (ouiiii detector, calibration, direct phrasing, pronunciation lexicon) + `transcribe` Edge Function (Groq, HF fallback) + rate limit | `packages/voice/`, `supabase/functions/transcribe/`, SQL 0007 / `04_voice.sql`, `VOICE.md` | ✅ done, reviewed; `transcribe` deployed by the owner |
| 4 | S6 | `S6-rooms.md`: rooms on two devices, lobby, QR / share, presence, Tireur-ready across devices, realtime, stale rooms, rematch | `apps/mobile/`, SQL 0008 / `05_rooms.sql`, regenerates `00` | ✅ done, reviewed, committed |
| 5 | S7b | `S7b-voice-in-app.md`: speak to play (Expo Go and web), hold-to-talk, calibration screen, Voix mode, fallbacks | `apps/mobile/`, small `packages/voice` additions | ✅ done, reviewed, committed |
| 6 | S7c | `S7c-live-voice.md`: live voice between players (WebRTC), TURN via Edge Function, dev build / APK | `apps/mobile/`, `supabase/functions/turn-credentials/` | after S9 (both own `apps/mobile`) |
| **next** | **S10** | **`S10-ui-first.md`: UI pass over every screen, icons (B2), Réglages screen (B4), voice choice male/female + speed (B3). App only, no SQL** | `apps/mobile/` | ▶ **owner priority: start when S11 is done** |
| 7 | S11 | `S11-rules-and-practice.md`: "QUESTION" goes back to the opening question (B1), practise one part of the book (B7) | `packages/core`, `supabase/`, `apps/mobile/`, GAME_RULES §4 + spec §2 | 🟡 running |
| 9 | S12 | `S12-hands-free.md`: hands-free voice-first play (B5, the main goal) | `apps/mobile/`, additive voice and core | after S7c |
| 10 | S8 | `S8-hardening.md`: opaque ids, leak-proof tests, abuse limits, audit, accessibility, CI, full README, device test plan | all | after S7c (or S7b) |
| any | S5 | `S5-admin.md`: Next.js admin, graph editor, import review, homonym descriptions, game settings | `apps/admin/` | ✅ done (features 1–4); Homonymes page → S5b; Réglages → S9 |
| any | S5b | `S5b-admin-homonyms.md`: the Homonymes page (descriptions for people sharing a name, with a Tireur card preview) | `apps/admin/` | ✅ done, reviewed, committed |
| 5 | S9 | `S9-timed-games.md`: **optional** timer (checkbox, 40 s thinking + 120 s game, admin Réglages), Tireur can change the name max 2×, the book's path shown when the name wasn't found | `supabase/` 0009 / `06_timer.sql`, `apps/mobile/`, `apps/admin/` Réglages, additive core | ✅ done, committed by that session; paste `06_timer.sql` when ready |

## The files a session needs

| File | What it is for |
|---|---|
| `docs/sessions/CONTEXT.md` | where the project stands, in 900 words. **Replaces reading the old reports.** The lead keeps it current. |
| `docs/sessions/CHECKS.md` | what to run and when, with measured timings. |
| `tools/screens/` | the committed screenshot harness. No session builds another. |
| `supabase/sql-editor/build.sh` | regenerates `00_all_migrations.sql`. That file is never hand-edited. |

**Backlog of owner remarks** (rewind to the opening question, icons, African-accented voice, app settings, hands-free voice-first play, admin pronunciation, practising a part of the book): `docs/sessions/BACKLOG.md`.

SQL files for the dashboard, in the order the owner pastes them: `00` → `01` → (`90` tests) → `02` admin → `03_game_ux` (S3b) → `04_voice` (S7a) → `05_rooms` (S6) → `06_timer` (S9) → later files. Every session's report says exactly which file is new.
