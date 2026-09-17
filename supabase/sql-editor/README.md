# SQL Editor files

These are the files the owner pastes into the hosted Supabase dashboard (**SQL Editor → New query → paste → Run**). No Docker and no Supabase CLI are needed.

| Order | File | What it does | Run again? |
|---|---|---|---|
| 1 | `00_all_migrations.sql` | Creates every table, function, RLS policy and the realtime publication | Yes, it is idempotent |
| 2 | `01_seed_mini_graph.sql` | Loads the small test graph `mini` (30 nodes) | Yes, it upserts |
| 3 | `90_tests.sql` | Runs every rule and security test inside a transaction, then **rolls back**. Expected result: one row, `ALL DSA TESTS PASSED` | Yes, it leaves nothing behind |
| 4 | `02_make_admin.sql` | Makes your account an admin. Edit `REPLACE_WITH_YOUR_EMAIL` first, and sign in once before running it | Yes |

`02` runs last because your account only exists after you sign in once.

## Upgrading a project that already ran 00 and 01

`03_game_ux.sql` brings an existing project up to date with the game UX update (homonym descriptions, the book-like path graph, game stats, the "Façon de jouer" setting). Paste it, **Run**, expect "Success. No rows returned", then run `90_tests.sql` again and expect `ALL DSA TESTS PASSED`. It is safe to run more than once. A new project doesn't need it: the regenerated `00_all_migrations.sql` already contains it.

| Order | File | What it does | Run again? |
|---|---|---|---|
| 1 | `03_game_ux.sql` | Same content as `migrations/0006_game_ux.sql` | Yes |
| 2 | `90_tests.sql` | Checks everything, including the new block 13 | Yes |

`04_voice.sql` adds the voice rate limit (see `VOICE.md`; tests in `94_voice_tests.sql`).

`05_rooms.sql` brings a project up to date with the rooms update (two phones: the Tireur-ready phase, stale-room cleanup, rematch). Run it after `03` (it stops with a clear message if `03` is missing), then run `90_tests.sql` again and expect `ALL DSA TESTS PASSED`. It is safe to run more than once, and a new project doesn't need it: the regenerated `00` contains it. The new `90` refuses to run on a project that skipped `05`.

| Order | File | What it does | Run again? |
|---|---|---|---|
| 1 | `05_rooms.sql` | Same content as `migrations/0008_rooms.sql` | Yes |
| 2 | `90_tests.sql` | Checks everything, including the new block 14 (rooms) | Yes |

The optional hourly stale-room cleanup (pg_cron) is described in [`DATABASE_SCHEMA.md`](../../DATABASE_SCHEMA.md#stale-rooms-0008).

The full step-by-step setup is in [`DATABASE_SCHEMA.md`](../../DATABASE_SCHEMA.md#setup-in-the-supabase-dashboard).

## Tips

- Paste the **whole** file, not a selection. The SQL Editor runs everything that is selected.
- If `90_tests.sql` fails, the error begins with `DSA TEST FAILED [<scenario>]`. Copy that line into the session report.
- The real book graph is loaded later by the importer scripts (`scripts/`), not from here.

## For developers

`00_all_migrations.sql` is **generated**. Edit `supabase/migrations/*.sql` and then run:

```bash
bash supabase/sql-editor/build.sh
```

Commit both the migrations and the regenerated `00_all_migrations.sql`. `03_game_ux.sql`, `04_voice.sql` and `05_rooms.sql` are `0006`, `0007` and `0008` with an owner-facing header; keep each pair identical when either changes.
