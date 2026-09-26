# Upcoming Player Forecast Readiness

**Status:** unavailable — no forecasts generated
**Audit as of:** 2026-09-26T15:30:40.823Z
**Nearest upcoming regular-season week games:** 15

Read-only readiness audit for the nearest upcoming regular-season week 3. Source census: 475 ESPN QB/RB/WR/TE roster rows; 415 unique regular-season player-stat identities, 367 linked through latest GSIS → ESPN identity to players.player_id. The latest persisted ESPN skill-player row change was 2026-09-17T22:00:09.000Z; this is not the time of the latest complete provider check. Injury evidence: 475 of 475 skill-player roster entries have a matching player/team record, 0 updated within 48 hours. Absence of a record does not establish health. No forecasts are generated or published by this audit. Current player/team assignments lack recent per-player verification; change-only ESPN rows cannot establish upcoming eligibility or support forecasts. ESPN injury coverage is missing or stale; player availability remains uncertain. No depth-chart snapshots exist; starter status cannot be verified.

## Why the audit is scoped to one week

The audit uses only the nearest future regular-season week with verified scheduled kickoff times. It deliberately does not describe later weeks: player team assignments, participation, injuries, and starter roles can change before those games, so extending eligibility claims to far-future schedule rows would overstate what current evidence supports.

## Source freshness

| Source | Latest timestamp | Age (hours) | Timestamp meaning / status |
|---|---|---:|---|
| roster | not recorded | unknown | No complete, independently timestamped current player/team roster observation is retained; players.source_updated_at records changes, not checks |
| injuries | 2026-09-17T22:00:09.000Z | 209.5 | injuries.source_updated_at (ESPN payload observation when supplied) timestamp is stale (over 48 hours old) |
| playerStats | 2026-09-26T15:01:51.775Z | 0.5 | nflverse_source_files.completed_at (import ingestion time, not provider publication time) timestamp is within the 48-hour audit window; NFLverse upstream publication time is not independently archived |

Roster freshness is unavailable because no complete timestamped player/team observation is retained. The latest persisted row-change time in the census is not the last provider check and cannot prove assignments were stale or fresh. Injury `source_updated_at` is also change-only and may contain a provider payload time or synchronization fallback; it does not prove the latest successful check. Player-stat source-file completion time represents import ingestion, not independently verified NFLverse publication time.

## Candidate eligibility

| Eligible | Uncertain | Excluded |
|---:|---:|---:|
| 0 | 358 | 117 |

| Reason | Count |
|---|---:|
| fewer_than_three_strictly_prior_regular_season_appearances | 89 |
| injury_status_not_fresh_and_confirmed_available | 358 |
| roster_assignment_not_recently_verified | 358 |
| starter_status_unknown_no_depth_chart | 358 |
| team_not_in_nearest_upcoming_week | 28 |

Player identity evidence is joined as latest nflverse `gsis_id` → `espn_id` → `players.player_id`. Player statistics contribute to the prior-appearance eligibility count only when the regular-season week is strictly earlier than the target week (or the season is earlier); same-week rows are withheld. Current roster team assignment, rather than historical stat team, is used to join a player to the upcoming slate, so transferred players are not carried forward under an old team.

## Readiness decision

- **Critical blocker:** Current player/team assignments lack recent per-player verification; change-only ESPN rows cannot establish upcoming eligibility or support forecasts.
- This endpoint and report are read-only; no synchronization, persistence, model fitting, or forecast generation occurs.
- Historical observed outcomes are used only to count prior appearances when their season/week strictly precedes the target. No future-week statistic or upcoming-game outcome is used.

