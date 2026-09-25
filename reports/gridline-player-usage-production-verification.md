# Gridline 2026 Player Usage — existing production import verification

**Date:** 2026-09-25. **Method:** read-only production-replica SELECTs, public production GETs, local inspection of current NFLverse source bytes and importer/UI code, and the existing handoff/audit. No import, sync trigger, production write, migration, database-binding change, deployment, model change, or sportsbook-history modification occurred.

**Assessment: PARTIALLY VERIFIED (B).** Player Usage is functioning with consistent sampled 2026 records and consumer responses. Neither the original imported source bytes nor the original physical database identity can be independently authenticated. Close the *repeat-import* workstream: another import is not indicated by the available evidence. Keep the provenance/identity verification gap open rather than relabeling it as proven.

## 1. Existing import and row-count evidence

- The original handoff is [player-usage-2026-production-handoff.md](player-usage-2026-production-handoff.md). It records an approved, scoped import of **only 2026 weekly player stats**, followed by public-API verification; it does not authorize a repeat import.
- Read-only production-replica `data_sync_runs` rows **537** (started 19:42:01 UTC) and **538** (started 19:42:20 UTC) both ended `success`, each reporting **2,291 records processed**. An older broad NFLverse attempt (row 427) was `partial`. These numbers document execution, not newly inserted row counts or proof of every value.
- `nflverse_source_files` row **17** is `success` for `player_stats` / 2026, URL `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz`, file size **150,127 bytes**, **2,294 source rows**, completed 19:42:21 UTC. This ledger does not store a source checksum.
- The replica currently returns exactly **2,291** `player_game_stats` rows for 2026: week 1 **1,117**, week 2 **1,106**, week 3 **68**. The currently fetched CSV has 2,294 rows; the importer excludes three rows missing `player_id`, leaving 2,291. A sorted digest of the accepted source's player/season/week/season-type/opponent keys matches the replica's 2026 key-set digest (`207d84daa18329b6cdb0087d663fff30`). This checks keys, not values or database origin.

## 2. Source provenance and sampled statistic comparisons

The source file fetched **during this verification** passes gzip validation, is 150,127 bytes, and has SHA-256 `3eead791eec69ec28820f10d7ae1e5137f158fe44f72d8e83c36816e40990c88`. Its URL and byte length match the production ledger, but the previously imported bytes were not retained with a trusted checksum. NFLverse can replace bytes at the same URL and size. Therefore, the comparisons below are against **today's source**, not proof of full historical value equality to the earlier import.

The following read-only replica rows match the corresponding fetched CSV rows on GSIS player ID, name, team, opponent, season 2026, week, and the listed passing/rushing/receiving/touchdown fields:

| Player (GSIS ID) | Weeks and exact sampled source/replica values |
| --- | --- |
| Patrick Mahomes (`00-0033873`), KC QB | W1 vs DEN: 27 pass attempts, 184 pass yards, 2 pass TD, 1 INT; 7 carries, 23 rush yards, 1 rush TD. W2 vs IND: 47 attempts, 382 pass yards, 3 pass TD, 0 INT; 2 carries, 17 rush yards, 0 rush TD. |
| Drew Lock (`00-0035704`), SEA QB | W1 vs NE: 22 attempts, 187 pass yards, 1 pass TD; 2 carries, 13 rush yards. W2 vs ARI: 26 attempts, 235 pass yards, 3 pass TD; 0 carries. |
| Sam Darnold (`00-0034869`), SEA QB | W1 vs NE only: 2 attempts, 13 pass yards, 0 pass TD. No W2 record is inferred. |
| Jaxon Smith-Njigba (`00-0038543`), SEA WR | W1 vs NE: 11 targets, 8 receptions, 122 receiving yards, 1 receiving TD. W2 vs ARI: 11 targets, 9 receptions, 155 receiving yards, 3 receiving TD. |
| Cooper Kupp (`00-0033908`), SEA WR | W1 vs NE: 3 targets, 2 receptions, 35 yards, 0 TD. W2 vs ARI: 2 targets, 2 receptions, 20 yards, 0 TD. |
| Quinshon Judkins (`00-0040784`), CLE RB | W1 vs JAX: 12 carries, 33 rush yards, 0 rush TD; 2 targets, 2 receptions, 17 receiving yards. W2 vs TB: 12 carries, 21 rush yards; 5 targets, 5 receptions, 27 receiving yards. |

**Observed discrepancies:** none in these sampled fields. This is not a comparison of every column or all 2,291 value rows. Passing statistics are present in persisted records, but the current consumer *usage* schema focuses on snap/target/rush/receiving metrics and does not expose QB passing totals; do not interpret the QB's zero receiving targets as missing passing data.

## 3. Live public Player Usage

All four unauthenticated, read-only `GET /api/consumer/player-usage` checks returned HTTP 200 with `season=2026`, `window=last3`, the requested team/position, and two included completed team games:

| Filter | Status and players | Cross-check |
| --- | --- | --- |
| SEA WR | `partial`; Cooper Kupp, Rashid Shaheed, Jaxon Smith-Njigba, Montorie Foster Jr | Jaxon: 22 targets, 17 receptions, 277 receiving yards, 4 total TD across weeks 1–2; matches 11+11, 8+9, 122+155, 1+3 in source/replica. |
| SEA QB | `partial`; Sam Darnold (week 1 only), Drew Lock (weeks 1–2) | Drew's 2 carries/13 yards match the persisted W1+W2 rushing values; no invented Darnold W2 appearance. |
| CLE RB | `partial`; Quinshon Judkins, Dylan Sampson, Raheim Sanders, Jaleel McLaughlin | Judkins: 24 carries, 54 rushing yards, 7 targets, 7 receptions, 44 receiving yards; matches the two persisted rows. |
| KC QB | `available`; Patrick Mahomes | 9 carries, 40 rushing yards, 1 total TD; matches the two persisted rows. |

The three `partial` results explicitly say **“Player histories are sparse relative to the requested window”** because only two completed team games exist for a last-three window. Some players appeared in just one. Unsupported red-zone touches/targets and explosive rate are returned as unavailable with `null` values and reasons; zero-denominator yards-per-target/carry likewise stays unavailable instead of becoming a fabricated zero. The response supplies per-game season/week and coverage metadata. Names and display-safe metric availability are present; no unsupported value was invented.

The matchup-filtered SEA WR GET for future game `401872955` still includes only completed 2026 week-1 `401872656` and week-2 `401872943`. Jaxon shows 11 targets/8 receptions/122 yards/1 TD and 11/9/155/3 respectively; the future week-3 game is not treated as historical evidence. Snap shares of 0.90 and 0.67 are consistent with the previously documented GSIS-to-PFR crosswalk, but this verification did not re-audit every snap source byte.

## 4. Game Detail

The production public `GET /api/consumer/games/401872955` returned HTTP 200 for scheduled week-3 SEA at WSH, including `keyPlayers` and their `recentUsage`. It includes Jaxon Smith-Njigba (22 targets, 277 receiving yards) and Drew Lock (2 carries, 13 rushing yards), consistent with the usage responses; AJ Barner and Abraham Lucas also appear with their available usage fields. The checked frontend source mounts `ConsumerKeyPlayers` on `ConsumerGameDetail` and explicitly renders unavailable metrics as unavailable, rather than numeric substitutes. **A rendered, authenticated production Game Detail page was not independently inspected in this read-only pass**; the component wiring and live JSON are verified, not pixel-level browser presentation.

## 5. Production continuity and limits

- The replica's `release_security_evidence` contains the deployed API build ID `e0f96a4ec791-2026-09-25T17:20:24.972Z`, with a passing startup verification. The production launcher starts API and worker with inherited configuration after that smoke check. Production worker log activity and scheduler records support operation, but there is **no independently attested worker-side physical database identity**.
- The replica's three approved Phase 6.1 model versions still carry the previously audited artifact IDs/checksums and the same 27-feature schema fingerprint `d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42`: spread `01c85917b47c6e70c258fe0258481c7a2a21e567c95db02cac38988baa4034bf`, moneyline `917fa6e7417cccb45909ade470c997d0841fe8a010bc18899f4b5b913be4d6ae`, totals `749279b5856f1be1165c211d3c6233c7c4f55d44d12ebcb2c94500db63b60c2f`. Metadata matches; this pass did not rehash complete fitted JSON.
- A scoped read of production prediction snapshots for game `401872955` finds current snapshot **28458** (September 25) referencing those versions and preserved earlier snapshots **223** and **152**. Snapshot 28458 is not labeled an official final prediction. A broad prediction-count query returned a transaction wrapper without result rows, so this report does **not** assert an exact global snapshot count.
- As documented in [gridline-production-recovery-audit.md](gridline-production-recovery-audit.md), no independently archived pre-incident physical database identifier or complete baseline fingerprint exists. The generic database name `neondb`, matching records, a replica query, and a passed connectivity check **do not establish original physical database identity**. This limitation remains **UNVERIFIED**.

## 6. Remaining action

**No corrective import is indicated, and no correction was executed.** Close the repeat-import workstream for currently functioning 2026 Player Usage. For stronger provenance, obtain the exact archived bytes/checksum of the earlier import and compare the full persisted value set; separately obtain a pre-incident physical database fingerprint and independently attest current API/worker bindings before claiming original-database continuity. If the Game Detail UI needs a presentation-level claim, perform an authorized production browser check separately. None of these verification gaps justifies a speculative repeat import.

**Final status: PARTIALLY VERIFIED. No production modifications occurred.**