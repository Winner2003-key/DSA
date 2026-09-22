# Brief S8 — Security, quality and release readiness

You are a senior full-stack engineer and security reviewer on **DSA — Découverte Sans Alphabet**. This is the pass before real players: close the known security gaps, prove the secret never leaks, test on real devices, and write the complete README.

**Start only after S7c** (or after S7b, if the owner postpones live voice).

## Read first
1. **`docs/sessions/CONTEXT.md`** — where the project stands. It replaces the old reports.
2. **`docs/sessions/CHECKS.md`** — what to run and when. Follow it.
3. `docs/sessions/README.md`: the global rules.
4. `GAME_RULES.md`, `GRAPH_SPECIFICATION.md`, `DATABASE_SCHEMA.md`, `IMPORT_GUIDE.md`, `VOICE.md`.
5. The **"open questions" section of each report** in `docs/sessions/reports/` — those sections
   are your backlog. `grep -A 30 -i "open questions" docs/sessions/reports/*.md` gets you all of
   them at once; that is the only part of those reports you need.

This is the one session that legitimately reads widely, so read narrowly *within* each file.
Don't open the screenshot folders.

## You own
Everything except the book transcription (`data/`, private). Keep changes minimal and justified. New SQL goes in the next free migration number, plus a matching `sql-editor/NN_*.sql`. Regenerate `00_all_migrations.sql`.

## Deliver
1. **Opaque ids in player-facing data** (S2 report open question 1, S4 open question 1):
   - players must never see graph node ids: `prompt.node_id`, `path[].node_id`, the `game_sessions.current_node_id` / `pending_prompt_node_id` columns, `game_moves.node_id`;
   - replace them in the RPC JSON with per-session opaque tokens (for example an HMAC of a per-session random secret and the node id), and map tokens back server-side in `dsa_go_back` and similar;
   - revoke player SELECT on the raw game tables where the realtime notifications allow it (for example publish only a `game_sessions.version` bump and let clients refetch through RPCs);
   - update the clients.
2. **Secret-leak proof:** an automated test that plays full games in every mode and scans **every** RPC response and realtime payload received by the Découvreur for the secret's name, description, node id or character id, using the offline service, and PGlite for the SQL side.
3. **Abuse limits:**
   - session creation per anonymous user (for example 30 per hour; `DSA_RATE_LIMIT`);
   - a join-attempt limit, so room codes can't be brute-forced (codes have only 4 digits);
   - review the voice rate limit (S7a).
4. **Audit:**
   - run the `security-review` skill on the whole repo;
   - check the RLS policies and grants table by table against `DATABASE_SCHEMA.md`;
   - make sure no key is in the git history or in any committed file (`git grep` for key patterns);
   - `.env` handling; service role key used only in `scripts/`;
   - triage `npm audit` (fix what's safe, document the rest).
5. **Quality:**
   - lazy-load the mini fixture so it isn't in production bundles (S3 §5.10), and remove unused dependencies (`expo-linear-gradient` if still unused);
   - accessibility: screen-reader labels on every control, focus order on web, contrast in both themes, text scaling;
   - performance on a low-end Android phone (the path graph with a long path).
6. **CI:** a GitHub Actions workflow (no Docker) that runs `npm ci`, every workspace's typecheck and tests, `expo-doctor` and the web export. Also a PGlite SQL test job that runs `00 → 01 → 90` plus the other `9x` test files.
7. **README.md** (repo root), complete and exact, for a new developer and for the owner:
   - what DSA is;
   - repo layout;
   - installing dependencies;
   - creating the Supabase project;
   - which SQL files to paste, in order;
   - enabling anonymous sign-ins;
   - environment variables per app;
   - importing the book (IMPORT_GUIDE);
   - creating an admin;
   - running the mobile app (Expo Go / web) and the admin;
   - testing multiplayer (two devices);
   - testing microphone and audio (calibration, VOICE.md);
   - deploying the web game and the admin on **Vercel** (root directories, build commands, env vars);
   - building the **Android APK** with EAS;
   - troubleshooting.
8. **Real-device test plan** (`docs/TEST_PLAN.md`): a checklist by mode, platform and network, for the owner to run with testers, with a place to record results.

## Verification (see `CHECKS.md`; summary lines only)
- all workspace tests and typechecks, **once**, at the end;
- SQL: regenerate with `build.sh`, then PGlite on the upgrade path (and the fresh path, since
  this session may change existing migrations);
- the leak-proof test;
- the CI workflow run locally with `act` is **not allowed** (it needs Docker). Instead, validate the YAML and run its commands by hand;
- the security-review summary.

## Report
Write `docs/sessions/reports/S8-hardening.md` with:
- findings (severity, fix, status);
- files and outputs;
- **exact SQL to paste**;
- remaining risks, and whether the app is ready for testers.
