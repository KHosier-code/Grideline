# Go live with the redesigned Gridline

Everything below happens outside the code. The order matters.

## 1. Merge the changes into `main`

Merge the branch `claude/beautiful-mendel-t4wvmz` into `main` on GitHub.

## 2. Pull and publish on Replit

1. In Replit, open **Git** and click **Pull**.
2. Click **Republish**. Replit applies the three new database tables
   (`touchdown_pick_runs`, `touchdown_pick_results`, `game_projection_runs`) when
   it publishes. If it asks you to approve a database change, approve it. It only
   adds tables and doesn't change existing ones. The same SQL is in
   `lib/db/migrations/0051_touchdown_picks.sql` and `0052_game_projection_runs.sql`.

## 3. Create the upload key (one password, used in two places)

The weekly GitHub job sends TD picks and game projections to the site. It proves
it's allowed to with a shared password.

1. Make a long random password (at least 24 characters), for example with a
   password manager.
2. **Replit**, under Secrets, including the deployment's secrets:
   - `GRIDLINE_INGEST_TOKEN` = the password
3. **GitHub**, under the repo's Settings → Secrets and variables → Actions → New repository secret:
   - `GRIDLINE_INGEST_TOKEN` = the same password
   - `GRIDLINE_INGEST_URL` = `https://gridelineanalytics.com`
4. Republish on Replit so the new secret takes effect.

## 4. Run the weekly job once by hand

On GitHub, open **Actions → Weekly picks → Run workflow**. After about 5 minutes:
- `https://gridelineanalytics.com/touchdowns` shows this week's TD picks
- the home page shows starting QBs and Gridline lines for every game

After that it runs on its own on Tuesday, Thursday, Friday after the injury
report, Saturday and Sunday morning.

## 5. Turn on the data worker (fixes "Unavailable" on game pages)

The live site's data worker hasn't been running, which is why schedules, odds and
the old projections went stale. In the Replit deployment's secrets, add
`GRIDLINE_NEW_WORKER_APPROVED` = `1` and republish. Only one worker may run, and
the deployment runs exactly one.

## What to check afterwards

- The home page loads with TD picks at the top and every game listed.
- A game page shows both starting quarterbacks.
- The Record page shows the tested numbers; this season's record fills in after the first graded week.
