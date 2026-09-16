# Work sessions

The lead session (the project manager) writes one brief per work session. **Each work session is a separate Claude Code session the owner opens, so it can be watched live.**

## How to start a session (VS Code)

1. Open the Claude Code panel and start a **new conversation** (new tab), with the working directory `/home/winner/projects/DSA`.
2. Send: `Read docs/sessions/<BRIEF>.md and carry out that brief completely.`
3. When it finishes, the session writes `docs/sessions/reports/<ID>.md`. Tell the lead session "S1 finished" (or just come back), and it will read the report and prepare the next briefs.

Sessions in the same wave can run **at the same time**, because they own separate folders. Don't start a later wave until the lead has reviewed the earlier wave's reports.

## Global rules for every session

- Read `GAME_RULES.md` and `GRAPH_SPECIFICATION.md` first. They are the contract.
- **No Docker. Never run `supabase start`, `db reset` or `test db`.** SQL is run by the owner in the Supabase dashboard.
- The PDF isn't in the repo, and must not be added.
- **The GitHub repo is public, and every push to `main` deploys to Vercel.** Never write the source book's title, author or organisation into any file. Never copy content from `data/` (the private transcription) or `DIGITIZATION_REPORT.md` into tracked files. Bible names are fine. The book graph's slug is `livre`.
- Only touch the folders your brief says you own. Don't git commit; the lead commits after review.
- The UI is French. Code and docs are in English.
- Finish by writing your report: what was done, the test result lines, deviations from the spec, and open questions.

## Plan

| Wave | ID | Brief | Owns | Status / when to start |
|---|---|---|---|---|
| 1 | S1 | `S1-core-engine.md` | `packages/core/`, root `package-lock.json` | ✅ done, reviewed |
| 1 | S2 | `S2-database-sql.md` | `supabase/`, `DATABASE_SCHEMA.md` | ✅ done, reviewed |
| 1 | LEAD | book transcription | `data/book/` (gitignored, private) | ✅ done: 53 pages, 1,209 names |
| 2 | S3 | `S3-expo-app.md`: Expo app, French UI, local and AI modes, TTS | `apps/mobile/` | ✅ done, reviewed |
| 2 | S4 | `S4-importer.md`: importer, validator CLI, id salt | `scripts/`, small core additions | ✅ done, reviewed; book imported by the owner |
| 3 | S3b | `S3b-game-ux.md`: clearer Découvreur, book-like path graph, engaging UI, input-mode setting, LOCAL starts with Tireur, homonym-only descriptions, direct phrasing | `apps/mobile/`, SQL 0006 / `03_game_ux.sql`, additive core | 🟡 running |
| 3 | S7a | `S7a-voice-foundations.md`: `packages/voice` (ouiiii detector, calibration, direct phrasing, pronunciation lexicon) + `transcribe` Edge Function (Groq, HF fallback) + rate limit | `packages/voice/`, `supabase/functions/transcribe/`, SQL 0007 / `04_voice.sql`, `VOICE.md` | ▶ **can start now, in parallel with S3b** |
| 4 | S6 | `S6-rooms.md`: rooms on two devices, lobby, QR / share, presence, Tireur-ready across devices, realtime, stale rooms, rematch | `apps/mobile/`, SQL 0008 / `05_rooms.sql`, regenerates `00` | after S3b |
| 5 | S7b | `S7b-voice-in-app.md`: speak to play (Expo Go and web), hold-to-talk, calibration screen, Voix mode, fallbacks | `apps/mobile/`, small `packages/voice` additions | after S6 and S7a, and after the owner deploys `transcribe` |
| 6 | S7c | `S7c-live-voice.md`: live voice between players (WebRTC), TURN via Edge Function, dev build / APK | `apps/mobile/`, `supabase/functions/turn-credentials/` | after S7b |
| 7 | S8 | `S8-hardening.md`: opaque ids, leak-proof tests, abuse limits, audit, accessibility, CI, full README, device test plan | all | after S7c (or S7b) |
| any | S5 | `S5-admin.md`: Next.js admin, graph editor, import review, homonym descriptions, game settings | `apps/admin/` | ⏸ postponed by the owner (independent folder: can run in parallel with anything) |
| hold | S9 | `S9-timed-games.md`: 40 s thinking time, 120 s game time, admin-configurable | `supabase/`, `apps/mobile/`, `apps/admin/` | ⛔ hold until the owner says go |

SQL files for the dashboard, in the order the owner pastes them: `00` → `01` → (`90` tests) → `02` admin → `03_game_ux` (S3b) → `04_voice` (S7a) → `05_rooms` (S6) → later files. Every session's report says exactly which file is new.
