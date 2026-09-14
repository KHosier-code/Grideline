# Automatic feed refresh

The API starts a minute-based scheduler with its existing service. No public cron endpoint or additional credentials are needed. Scheduled executions call the same ingestion functions as manual syncs.

All slots use America/New_York (including daylight saving time):

| Feed | August–February | March–July |
|---|---|---|
| Injuries | Every three hours Thu/Sat/Sun/Mon; 09:00 and 18:00 Tue/Wed/Fri | Wednesday 12:00 |
| nflverse | Tuesday and Wednesday 14:00 | Tuesday 14:00 |

The broad game-day windows cover Thursday, Saturday playoff games, Sunday and Monday without depending on every team playing (bye weeks). January/February use the previous calendar year's NFL season. Tuesday imports occur after Monday night rollover; Wednesday imports pick up delayed weekly releases. No provider publication time is guaranteed: missing/partial season data is recorded as a failure, never silently reused. Automated nflverse runs bypass the local download cache.

Each slot gets at most four attempts: initial, then 5, 15 and 45 minutes after failed completion. PostgreSQL run history persists attempts across restarts. Advisory locks serialize each feed across replicas and manual requests (409 when busy). Restarted interrupted scheduled attempts are marked failed. On startup only the latest due slot is caught up, not every missed historical slot; a new slot supersedes retries for older slots. Data Health shows individual attempts and source errors. Previous seasons can still be backfilled through the manual endpoint.

## Hosting

An hourly ESPN kickoff-calendar lookup also promotes special Wednesday/Friday game dates to the three-hour injury cadence. Calendar failures are logged, retried after five minutes, and retain the baseline cadence rather than stopping injury refreshes.

The project is configured for a Reserved VM deployment because an in-process scheduler requires an always-running API. Autoscale can sleep and is not suitable for unattended scheduled execution. Publishing this configuration may change hosting costs; review the Publishing settings before publishing. Development scheduling runs only while the API workflow runs. This change does not itself publish the app.

## Checks

From the repository root:

```
pnpm --filter @workspace/api-server exec esbuild src/lib/feed-schedule.test.ts --bundle --platform=node --format=esm --outfile=/tmp/feed-schedule.test.mjs
node --test /tmp/feed-schedule.test.mjs
pnpm --filter @workspace/api-server typecheck
```