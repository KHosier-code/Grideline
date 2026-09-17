# SportsDataIO NFL depth quality evaluation

## Access and licensing preflight

- Evaluated endpoint: `GET https://api.sportsdata.io/v3/nfl/scores/json/DepthCharts`
- Alternative documented endpoints: `DepthChartsAll` and `DepthChartsByWeek/{season}/{week}`
- Authentication: `Ocp-Apim-Subscription-Key` request header. The documented query-string key form is intentionally not used because URLs are more likely to be logged.
- Documented call interval: 15 minutes.
- Account-tier access: not verified. `SPORTSDATAIO_API_KEY` is not configured in the development environment.
- Production use: not verified. SportsDataIO publicly distinguishes trial/replay access from sales-provisioned production keys.
- Commercial licensing: not verified. No redistribution, publication, or commercial-use permission is inferred from public API documentation.
- Provider requests made: 0.
- Paid payload rows retained: 0.

The access path stopped cleanly before capture, identity loading, cross-source queries, or unrelated integration work. The implementation can perform one read-only capture after a key and the applicable licensed feed are available, but this report does not claim those permissions.

## Reproducible evaluation capability

The isolated evaluator:

1. Parses one active depth-chart response and preserves provider depth-chart/player/team IDs, player names, original position and category labels, exact depth order, unit, status-like fields, provider update/version values, capture time, and a source fingerprint.
2. Stores parsed fields only in dedicated append-only evaluation tables. It never stores the API key, request URL with credentials, or raw paid payload.
3. Maps explicit SportsDataIO IDs first, verified crosswalks second, and exact normalized name + canonical team + compatible position last.
4. Leaves multiple candidates, unmatched rows, and target collisions unresolved.
5. Preserves exact LT/LG/C/RG/RT, FS/SS, slot-corner, and EDGE/DE role evidence.
6. Produces a fixed 32-team role matrix for offense, defense, and special teams, including missing roles, mapping counts, freshness, conflicts, current-versus-candidate coverage, and WR-CB readiness.
7. Evaluates a proposed hierarchy without activating it.

## Audit result

No provider capture exists, so mapped and eligible SportsDataIO counts are both zero. A provider-quality comparison against current Gridline, cutoff-safe Sleeper, nflverse participation, and ESPN injury evidence would be misleading without licensed source rows. Current baseline values remain:

| Cohort | Current verified/mapped coverage | SportsDataIO candidate |
|---|---:|---:|
| Current depth | 1,317 / 1,472 | Not evaluated |
| Current starters | 487 / 543 | Not evaluated |
| CB1 | 26 / 32 | Not evaluated |
| CB2 | 28 / 32 | Not evaluated |
| Starting safeties | 31 / 64 | Not evaluated |
| EDGE starters | 57 / 64 | Not evaluated |
| Exact LT/LG/C/RG/RT | 0 / 160 | Not evaluated |
| WR-CB readiness | Not ready | Not evaluated |

No source disagreement or gap resolution is claimed. Freshness is unavailable because no provider timestamp was captured.

## Isolation and regression boundary

- Existing current and historical depth tables are not read or written by provider capture.
- Current production depth-source precedence is unchanged.
- No SportsDataIO fields or raw payloads are exposed through consumer routes.
- No recurring polling or production activation was added.
- No Phase 6.1 feature, model artifact, training, evaluation, promotion, prediction, or inference code changed.
- Focused checks cover role preservation, identity precedence, ambiguity and collision rejection, a fixed 32-team audit, and secret-safe preflight behavior.

## Recommendation and publish impact

SportsDataIO may contain the exact slot detail needed, but material improvement, freshness, identity quality, account access, production use, and commercial licensing could not be verified without the licensed feed. It must not become a primary published source on this evidence.

**Publish required: No.** The evaluator and schema are development-only candidate infrastructure. Publishing would not make the inaccessible audit more complete and would create no production behavior change.

## Final verdict

**SPORTSDATAIO NOT RECOMMENDED AS PRIMARY DEPTH SOURCE**