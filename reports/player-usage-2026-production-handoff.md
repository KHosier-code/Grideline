# 2026 player usage: production handoff

**Status:** Production import and public verification pending. The user explicitly approved importing **only 2026 weekly player stats** after the corrected importer is published. They also approved handing off the import and verification because this task's isolated changes cannot be included in the published main project until this task is applied.

The development verification is in [player-usage-2026-development-verification.md](player-usage-2026-development-verification.md). The scoped admin action in `artifacts/api-server/src/routes/data-sync.ts` selects only season 2026, dataset `player_stats`, with a refreshed download and a sync-ledger entry. The admin Data Health page confirms the deployed source URL before enabling the manual import. Neither publishing nor loading that page starts an import.

## Last observed production state (2026-09-25)

- The published build was based on an older main-project commit and returned **404** for `GET /api/data-sync/player-stats-2026`; it did **not** contain this task's importer.
- The production `nflverse_source_files` ledger recorded `player_stats`, season `2026`, source `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz`, status `failed`, with “source contains no usable rows for the requested season.”
- Public SEA WR and KC QB team/position requests returned 2026 with no players. No production import was executed as part of this task.

## After applying this task to main and republishing

1. Confirm the new publication is healthy. Unauthenticated `GET /api/data-sync/player-stats-2026` should return **401**, not 404; sign in as an authorized admin at `/admin/data-health` and confirm the displayed deployed source is exactly `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz`. Stop if the URL differs.
2. Use the **2026 player usage recovery** panel to confirm and run the single scoped import. Do **not** invoke `/api/data-sync/nflverse`, an all-feed backfill, or the development-only CLI. The existing approval is limited to the 2026 weekly player-stat import. Record the import result and inspect the source-file and sync-run ledgers for successful completion and a nonzero 2026 row count.
3. Verify the public endpoints `/api/consumer/player-usage?team=SEA&position=WR&window=last3`, `?team=SEA&position=QB&window=last3`, `?team=CLE&position=RB&window=last3`, and `?team=KC&position=QB&window=last3`. Check that each returns season 2026, expected team/position players and credible completed-game counts; `partial` is valid when snap or history coverage is incomplete.
4. Verify `/api/consumer/player-usage?team=SEA&position=WR&window=last3&game=401872955` resolves only games before that matchup's kickoff, and cross-check the included season/week/team/opponent identities against the 2026 schedule. For snap share, verify the persisted GSIS-to-PFR player crosswalk and snap rows rather than assuming player IDs or raw game IDs match across sources. Never fill unsupported metrics with invented values.
5. Record the production result and any partial-coverage reasons. Only describe the published site as restored after these public checks pass.