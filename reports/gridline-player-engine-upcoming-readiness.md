# Upcoming Player Forecast Readiness

**Status:** unavailable — no forecasts generated
**Audit as of:** 2026-09-26T18:58:23.353Z
**Nearest upcoming regular-season week games:** 15

Read-only readiness audit for the nearest upcoming regular-season week 3. Source census: 512 ESPN QB/RB/WR/TE roster rows; 415 unique regular-season player-stat identities, 387 linked through latest GSIS → ESPN identity to players.player_id. The latest persisted ESPN skill-player row change was 2026-09-26T18:58:03.000Z; this is not the time of the latest complete provider check. Injury evidence: 512 of 512 skill-player roster entries have a matching player/team record, 368 updated within 48 hours. Absence of a record does not establish health. No forecasts are generated or published by this audit. Current player/team assignments lack recent per-player verification; change-only ESPN rows cannot establish upcoming eligibility or support forecasts. No depth-chart snapshots exist; starter status cannot be verified.

## Why the audit is scoped to one week

The audit uses only the nearest future regular-season week with verified scheduled kickoff times. It deliberately does not describe later weeks: player team assignments, participation, injuries, and starter roles can change before those games, so extending eligibility claims to far-future schedule rows would overstate what current evidence supports.

## Source freshness

| Source | Source field | Age (hours) | Last attempted | Last success | Valid retrieval | Changed-row write | Provider publication | Meaning / status |
|---|---|---:|---|---|---|---|---|---|
| roster | not recorded | unknown | 2026-09-26T18:58:01.583Z | 2026-09-26T18:58:03.196Z | 2026-09-26T18:58:02.491Z | 2026-09-26T18:58:02.491Z | unverified | No complete, independently timestamped current player/team roster observation is retained; players.source_updated_at records changes, not checks; Sleeper retrieval does not verify ESPN roster assignments |
| injuries | 2026-09-26T18:58:03.000Z | 0.0 | 2026-09-26T18:58:03.218Z | 2026-09-26T18:58:08.828Z | 2026-09-26T18:58:08.828Z | 2026-09-26T18:58:08.824Z | 2026-09-26T18:58:03.000Z | injuries.source_updated_at (ESPN payload observation when supplied) timestamp is within the 48-hour audit window; injury-only rows cannot confirm omitted players healthy; legacy runs lack response validity metadata |
| playerStats | 2026-09-26T15:01:51.775Z | 3.9 | unknown | unknown | unverified | unknown | unverified | nflverse_source_files.completed_at (import ingestion time, not provider publication time) timestamp is within the 48-hour audit window; NFLverse upstream publication time is not independently archived |

Roster freshness is unavailable because no complete timestamped player/team observation is retained. The latest persisted row-change time in the census is not the last provider check and cannot prove assignments were stale or fresh. Injury `source_updated_at` is also change-only and may contain a provider payload time or synchronization fallback; it does not prove the latest successful check. Player-stat source-file completion time represents import ingestion, not independently verified NFLverse publication time.

## Candidate eligibility

| Eligible | Uncertain | Excluded |
|---:|---:|---:|
| 0 | 367 | 145 |

| Reason | Count |
|---|---:|
| confirmed_unavailable_injury_status | 18 |
| fewer_than_three_strictly_prior_regular_season_appearances | 98 |
| injury_status_not_fresh_and_confirmed_available | 125 |
| roster_assignment_not_recently_verified | 367 |
| starter_status_unknown_no_depth_chart | 367 |
| team_not_in_nearest_upcoming_week | 29 |

Player identity evidence is joined as latest nflverse `gsis_id` → `espn_id` → `players.player_id`. Player statistics contribute to the prior-appearance eligibility count only when the regular-season week is strictly earlier than the target week (or the season is earlier); same-week rows are withheld. Current roster team assignment, rather than historical stat team, is used to join a player to the upcoming slate, so transferred players are not carried forward under an old team.

## Readiness decision

- **Critical blocker:** Current player/team assignments lack recent per-player verification; change-only ESPN rows cannot establish upcoming eligibility or support forecasts.
- This endpoint and report are read-only; no synchronization, persistence, model fitting, or forecast generation occurs.
- Historical observed outcomes are used only to count prior appearances when their season/week strictly precedes the target. No future-week statistic or upcoming-game outcome is used.

