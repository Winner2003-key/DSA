# S7c — A room in Voix mode is a live call (LiveKit)

## 1. Files

| Area | Files |
|---|---|
| SQL | `migrations/0011_room_call.sql` = `sql-editor/08_room_call.sql`; `00_all_migrations.sql` (build.sh) |
| Edge Function | `supabase/functions/livekit-token/{core.ts,index.ts,dashboard-single-file.ts}`; `packages/voice/scripts/bundle-function.mjs` now bundles both functions |
| Call layer | `apps/mobile/src/call/{types,call,call.native,call.web,token,use-call,index}.ts` |
| App | `views/call-play.tsx` (new), `views/room-table.tsx`, `views/voice-play.tsx`, `views/lobby-view.tsx`, `app/jouer/index.tsx`, `app/resultat/[sessionId].tsx`, `components/result-header.tsx`, `components/icon.tsx`, `state/use-game.ts`, `state/use-call-allowance.ts`, `services/{types,game-service,supabase-game-service,offline-game-service}.ts`, `i18n/fr.ts`, `app.json`, `eas.json` |
| Admin | `lib/settings-repository.ts`, `components/settings-form.tsx` |
| Docs | `VOICE.md` → "Appel dans une salle"; `sql-editor/README.md` |

SQL adds `dsa_declare_result`, `dsa_call_allowance`, `call_usage`, the four
`app_settings` values, `game_sessions.call_started_at/call_ends_at`, and
`end_event` on `dsa_get_revealed_path`. `dsa_end_thinking` opens the call clock;
`dsa_tick` ends the game at `call_ends_at` (`CALL_TIME_UP`), the game timer winning
a tie. Both players are charged on any ending, by a trigger on the status change.
Refusals only at creating/joining a Voix room, Tireur-ready and rematch.

## 2. Packages (`npx expo install`)

`@livekit/react-native ^3.0.0`, `@livekit/react-native-webrtc ^144.2.0`,
`@livekit/react-native-expo-plugin ^1.0.3`,
`@config-plugins/react-native-webrtc ^15.0.2`, `livekit-client ^2.22.3`.
Both plugins added to `app.json`; `eas.json` gains `development-device`
(`ios.simulator: false`).

## 3. Checks

- `npm run typecheck --workspaces --if-present` — clean (core, voice, admin, mobile, scripts).
- `cd apps/mobile && npx expo export -p web` — `Exported: dist`.
- `npx jest --ci` in `apps/mobile` — **25 suites, 244 tests passed**.
- Also run, because shared types changed: `packages/voice` 165 passed, `apps/admin` 93 passed.

Updated, not added: `voice-rooms-phrasing` (its two cases asserted a room reciting
moves by voice — now a call) and the fixtures carrying the new state fields.

## 4. The owner's steps

1. cloud.livekit.io → project → **Keys** → URL, API key, API secret.
2. Supabase → Edge Functions → Secrets: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
3. Deploy `livekit-token` (paste `dashboard-single-file.ts`, **Verify JWT on**; or `--use-api`).
4. SQL Editor → `08_room_call.sql` → then `90_tests.sql`.
5. `eas build -p android --profile development`, install the APK, `npx expo start --dev-client`.
6. iPhone: paid Apple account, `eas device:create`, `--profile development-device`. Or Safari on the web.

## 5. Open questions

- `90_tests.sql` has no block for the call (no new tests this session); worth one next.
- `call_usage` is never pruned; a monthly cleanup could join the pg_cron job.
- `CreateRoom` is best effort: if LiveKit refuses it, the room is still made on
  first join, so `maxParticipants: 2` is not guaranteed.
