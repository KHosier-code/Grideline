# Gridline red-zone Week 2 recovery and release blockers

**Decision: HOLD.** Development verification on 2026-09-25 (America/Chicago; some UTC evidence is dated September 26). This is a targeted follow-up to `gridline-red-zone-final-release-gate.md`, **not** a repeat production audit. Prior passes for gates 1, 2, 3, 5, 8 and 9 were not reclassified. No Publish, production migration/write, production worker start, production model change, or paid-provider request was made.

| Gate | Result | Reason |
| --- | --- | --- |
| **4 — Migration-before-start ordering** | **UNVERIFIED** | The fail-closed parent now verifies schema and launches API before worker. The actual Replit Publish **migration-before-run-command** ordering has not been demonstrated in a deployment preview or production rollout; the cited public documentation does not explicitly specify that ordering. |
| **6 — Development Week 2 coverage** | **PASS** | Fresh public 2026 PBP contains precisely 16 mapped Week 2 games; all 16 have player and team facts in the development database. Week 1 counts were preserved. |
| **7 — Week 2 calculation accuracy** | **PASS, within the specified PBP definition** | An independent CSV calculation agrees with **all 942 player-zone facts and all 96 team-zone facts**, positive and zero, across every Week 2 game after documented team-alias normalization. Season/last-three/cutoff and missing-data behavior were checked separately. |
| **10 — Startup safeguards** | **PASS locally; production exercise pending** | Missing/invalid schema blocks both services in tests, development recovery checks DB identity, repeat derivation is idempotent, scheduling remains worker-owned, and the existing published prediction snapshot count is unchanged. The actual new production startup has not been run. |

## Fresh development-only PBP recovery

The purpose-built `refresh:red-zone-week2:dev` command checks `NODE_ENV`, rejects deployments, requires an explicit confirmation argument and, **before network or disk/database writes**, verifies the current DB identity (`heliumdb`, role `postgres`, primary reached through the local proxy). It takes the existing NFLverse advisory lock, creates a `data_sync_runs` record, fetches **only** `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz`, checks gzip/size/CSV columns, verifies the 2026 season and a one-to-one mapping of all 16 Week 2 source IDs to the 16 final canonical schedule IDs, and validates red-zone derivation without writing facts. It then uses the ordinary PBP normalizer and red-zone transactional game replacement, atomically renames the validated file into the development cache, and records the successful source/run ledger. Failures are marked on the run and the temporary file is removed. The cache rename and DB transaction cannot be atomic together: a crash between them can leave the old cache with already refreshed facts; rerun the guarded command to reconcile, rather than treating the cache timestamp alone as proof of fact provenance. An existing cache is not replaced on a validation failure.

**Observed fresh download:** SHA-256 `fba617ba87b0cc7c965ce8a03d616e0e1ad2e809fdb3619e7a5d4a186adfd17a`; gzip size **2,216,307 bytes**; **5,662** CSV data rows, of which **2,733** are regular-season Week 2 rows; precisely **16** Week 2 source game IDs and **16** different canonical final game IDs (canonical IDs `401872932`–`401872947`). Earliest/latest canonical kickoff: September 18 00:15 / September 22 00:15 UTC. The development PBP ledger reports `success`, 5,662 source rows; the recovery sync run reports `success`, 2,961 processed normalized/derived records. No other datasets were downloaded by this command.

**After refresh and after a second, cached-only derivation**, the development database returned identical counts:

| Week | Canonical games with player facts | Player-zone rows | Canonical games with team facts | Team-zone rows |
| --- | ---: | ---: | ---: | ---: |
| 1 | 16 | 1,761 | 16 | 96 |
| 2 | 16 | 942 | 16 | 96 |

The second derivation reported 32 games, 2,703 player facts, 192 team facts and 5,192 deduplicated matched plays overall. Its replacement is keyed by game and guarded by PKs, so the repeated execution did not append duplicates. For the cached-only command, pass the season **without** an extra `--`: `pnpm --filter @workspace/api-server run derive:red-zone:dev 2026`.

## Independent Week 2 accuracy reconciliation

Reproduce the independent source pass with:

```sh
python3 scripts/validate-red-zone-week2.py \
  artifacts/api-server/.cache/nflverse/play_by_play_2026.csv.gz \
  > /tmp/gridline-week2-source.json
```

The script uses Python's standard CSV/gzip modules, not Gridline's TypeScript derivation. It deduplicates by source game/play ID, excludes deleted/no-play/two-point/kneel/spike/null-yardline rows, credits only identified receivers/rushers, applies **inclusive** 20/10/5 boundaries and normalizes NFLverse `LA`→`LAR`, `WAS`→`WSH`. Valid plays and credited identities outside a given zone establish observed-zero team/player rows, not opportunities. Compare its source-game/team/zone and source-game/team/player/zone outputs to read-only development queries against `red_zone_team_game_facts` and `red_zone_player_game_facts` with `season=2026 AND week=2`. **All 96 team rows and all 942 player rows match the independent source calculation, including every zero count and both player touchdown types: 0 missing keys or value mismatches.** This includes **81** positive and **15** zero team rows, plus **265** positive and **677** zero player rows. Week 2 has **314 player identities per zone** (942 rows), with **265**, **236** and **176** zero-opportunity rows at zones 5, 10 and 20 respectively. Week 2 has no `player_game_stats` or `snap_counts` rows in development; its zero rows are supported by credited PBP participation rather than missing-week imputation.

| Zone (inside, inclusive) | Independent source targets | Independent source carries | Stored team targets/carries |
| --- | ---: | ---: | --- |
| 5 | 24 | 48 | 24 / 48 |
| 10 | 49 | 75 | 49 / 75 |
| 20 | 122 | 144 | 122 / 144 |

All **32** Week 2 game/team records have three zone rows; **0** have non-monotonic target/carry totals or missing 5/10/20 rows. Representative play-level checks:

- `2026_02_CAR_ATL`, play `309`: credited incomplete target at yardline 2 to receiver `00-0040124`; included inside all three zones. The receiver's game totals are **2/3/3 targets** at 5/10/20, no receiving TDs.
- `2026_02_CAR_ATL`, play `411`: receiving TD at yardline 3 for `00-0036555`; this player's game has **1/1/1 targets**, **1/2/3 carries**, and **1/1/1 receiving TDs** across 5/10/20.
- `2026_02_DET_BUF`, play `317`: rushing TD at yardline 1 for `00-0034857`; stored **2/2/3 carries** and **2/2/2 rushing TDs** across 5/10/20.
- `2026_02_CAR_ATL`, `00-0032392`: **0/0** targets/carries at zone 20, supported by four credited targets **outside** the 20 (yardlines 64, 25, 58, 54), not fabricated from an absent game.

Consumer endpoint checks for Seattle `00-0038543`, zone 20: Week 1 stored **3 targets/0 receiving TDs**, Week 2 **3 targets/2 receiving TDs**, with Week 1 and 2 team targets **3 + 6** and carries **3 + 15**. Both `period=season` and `period=last3` return two covered appearances, **6 targets, 2 receiving TDs, team targets 9, team carries 18, target share 6/9**, and `missingWeeks=[]`. With `game=401872943` as the Week 2 pregame cutoff, the endpoint returns only Week 1 (**3 targets**, no receiving TD), proving Week 2 is excluded from its own pregame window. There are currently **no completed Week 3 games** in the development schedule, so a live missing-Week-3 response is not applicable yet. The focused route fixture explicitly verifies that a requested but uncovered week stays in `missingWeeks` and does not become a zero; incomplete and zero-denominator shares remain null.

## Publishing order and startup safeguards

The approved additive production diff previously inspected consists of **two new fact tables and three dependent indexes**; its check constraints/PKs are within the table DDL, with no foreign keys. **Re-inspect the actual Publish diff** against that known-safe structure before approval. The merged parent preflight executes a read-only `SELECT 1`, checks both fact tables, **six validated constraints** and **three ready/valid owned indexes**, and records existing release evidence before spawning either process. A missing/invalid object exits nonzero without starting API or worker. I corrected the parent launch order to **API then worker**, and an isolated test confirms the worker waits for an asynchronous API start and is not launched when that start throws. The API red-zone read path returns a controlled 503 when its data query fails; without the schema, the production parent will not launch the API at all.

The [Replit development/production database documentation](https://docs.replit.com/features/data-and-storage/development-and-production) states that development schema changes are applied to production *at publishing* and recommends an isolated deployment preview for checking migration effects. The retrieved page **does not explicitly state** that the managed schema diff has finished *before the deployment run command starts*. Search summaries suggested such an order, but that stronger statement is not present on the cited page and was not verified here. The parent preflight guarantees **no API or worker starts before the required schema is present**; it cannot guarantee that Publish first performs the migration, nor automatically recover if the platform starts the parent prematurely and migration follows after it exits. **Gate 4 therefore remains UNVERIFIED.** The required release change is a documented/confirmed **migration-completion-before-run-command dependency**, or an owner-approved pre-deploy migration step that applies only the reviewed additive diff and verifies it before the new parent can run. Confirm it in an isolated deployment preview or equivalent deployment configuration/log evidence, including the API-before-worker launch order, before calling this gate PASS. This report did not create a preview or publish.

Gate 10 local checks: the worker is not running in development; production startup remains blocked on the schema preflight; the recovery CLI rejected the wrong environment/DB identity before writes by construction and was actually run only against the verified development identity; the existing NFLverse advisory lock excludes concurrent syncs; a successful recovery and its metadata were recorded; failure paths set `data_sync_runs.status=failed` (not deliberately induced against a live data source). Normal feed requests remain in `startFeedScheduler`/`runScheduledFeed` under `shouldAttempt`, with the existing persisted scheduler skipping missed occurrences rather than launching catch-up jobs. **Starting the production worker will nevertheless evaluate current approved feed slots immediately**, so the owner must inspect post-start provider requests; we did not start it. The prior Phase 6.1 production model checks were not rerun. A scoped read-only production query still found **259 prediction snapshots, one official and one frozen**, unchanged from the earlier release review; the development recovery does not write model or prediction tables.

Verification completed: shared-library, API and consumer-web TypeScript checks passed; API build passed; **34/34** focused tests passed (red-zone arithmetic, exact source identity, database schema guard and launch order, feed scheduling, and consumer red-zone route). The development API workflow restarted cleanly, the worker remained **NOT_STARTED**, and the web preview rendered without a browser error. No paid provider was called. An initial cached-only rerun command with a literal pnpm `--` failed at argument validation **without making a database change**; rerunning with the documented syntax succeeded and preserved counts.

## Owner action before any release

Do **not** interpret local gates as production verification. First prove/configure Gate 4's migration-before-run-command dependency, review the actual Publish schema diff for only the approved additive DDL and no loss of existing data, and obtain explicit owner approval. Only then should the owner initiate Publish with the production parent entrypoint (not the worker directly). During rollout, verify from deployment logs that the migration completed, then the schema/database preflight passed, then the API started, then the worker started. Check the production DB identity/build evidence and the two tables, six constraints and three indexes; confirm one official frozen Phase 6.1 snapshot and existing 259-snapshot baseline have not been altered unexpectedly; inspect provider run records for only scheduled activity, no catch-up or failed sync, and confirm API health. Recheck actual counts rather than assuming the development 2026 Week 2 facts transferred: this recovery was intentionally **development-only**, and production Week 2 facts will require a separately approved scheduled refresh. Until those checks pass, production remains **unverified**.

**HOLD**