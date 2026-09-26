# Gridline Player Projection Independent Validation

**Status:** frozen-model independent validation — historical outcomes only  
**Generated:** 2026-09-26T15:14:56.685Z  
**Frozen baseline:** gridline-player-projection-historical-v1  
**Frozen baseline report SHA-256:** `131c5672ce49d28b0fd226be4465d188d6403f1a5da19f88bd69e35c5ad6dc3e`  
**Frozen training seasons:** 2021, 2022, 2023; minimum prior appearances: 3; ridge penalty: 2  
**Frozen feature definitions:** intercept, priorLast3TargetMean:z, priorLast3TargetMean:missing, priorLast5TargetMean:z, priorLast5TargetMean:missing, priorLast8TargetMean:z, priorLast8TargetMean:missing, seasonToDateTargetMean:z, seasonToDateTargetMean:missing, priorLast3VolumeMean:z, priorLast3VolumeMean:missing, priorLast8VolumeMean:z, priorLast8VolumeMean:missing, priorLast3Efficiency:z, priorLast3Efficiency:missing, priorLast8Efficiency:z, priorLast8Efficiency:missing, teamSeasonPassRate:z, teamSeasonPassRate:missing, opponentSeasonDefensiveEpaAllowed:z, opponentSeasonDefensiveEpaAllowed:missing, teamRestDays:z, teamRestDays:missing  
**Evaluation seasons:** 2025, 2026

This report applies the original 2021–2023 fitted parameters without refitting to completed 2025 and 2026 regular-season player games. It is an independent holdout evaluation, not a live projection or betting recommendation.

## Results by holdout season

| Family | Season | Eligible / candidates | Players | Availability | Model MAE | RMSE | Bias |
|---|---:|---:|---:|---:|---:|---:|---:|
| QB passing yards | 2025 | 619 / 664 | 76 / 81 | 93.2% | 67.792 | 84.282 | 4.543 |
| QB passing yards | 2026 | 76 / 78 | 42 / 44 | 97.4% | 69.189 | 87.744 | -0.251 |
| RB rushing yards | 2025 | 1458 / 1575 | 140 / 151 | 92.6% | 19.923 | 28.818 | 0.043 |
| RB rushing yards | 2026 | 159 / 189 | 90 / 108 | 84.1% | 22.203 | 30.523 | 0.471 |
| WR/TE receiving yards | 2025 | 3566 / 3798 | 345 / 378 | 93.9% | 18.904 | 25.903 | 1.389 |
| WR/TE receiving yards | 2026 | 405 / 471 | 221 / 263 | 86.0% | 21.218 | 30.274 | -0.634 |
| WR/TE receptions | 2025 | 3566 / 3798 | 345 / 378 | 93.9% | 1.334 | 1.775 | 0.124 |
| WR/TE receptions | 2026 | 405 / 471 | 221 / 263 | 86.0% | 1.455 | 1.924 | 0.066 |

## Retained 2024 comparison

The 2024 values below are read from the unchanged frozen baseline report, not recalculated on the recovered data. Different season cohorts and schedule-time quality mean changes in MAE are descriptive, not a head-to-head significance test.

| Family | 2024 eligible / MAE / RMSE / bias | 2025 eligible / MAE / RMSE / bias | 2026 eligible / MAE / RMSE / bias |
|---|---|---|---|
| QB passing yards | 636 / 66.665 / 83.507 / -1.768 | 619 / 67.792 / 84.282 / 4.543 | 76 / 69.189 / 87.744 / -0.251 |
| RB rushing yards | 1267 / 22.224 / 29.803 / -0.923 | 1458 / 19.923 / 28.818 / 0.043 | 159 / 22.203 / 30.523 / 0.471 |
| WR/TE receiving yards | 3031 / 20.932 / 28.290 / -0.412 | 3566 / 18.904 / 25.903 / 1.389 | 405 / 21.218 / 30.274 / -0.634 |
| WR/TE receptions | 3031 / 1.478 / 1.980 / -0.079 | 3566 / 1.334 / 1.775 / 0.124 | 405 / 1.455 / 1.924 / 0.066 |

## Paired baseline comparisons

Each baseline is compared with the frozen model on exactly the rows where that baseline is available. Last-3, last-5, and season-to-date means are extracted with the same strict chronological feature logic as the original evaluator.

| Family | Season | Baseline | N | Baseline MAE | Frozen model MAE on same rows |
|---|---:|---|---:|---:|---:|
| QB passing yards | 2025 | Last 3 appearances | 619 | 73.982 | 67.792 |
| QB passing yards | 2025 | Last 5 appearances | 595 | 72.045 | 67.191 |
| QB passing yards | 2025 | Season to date | 556 | 67.807 | 67.283 |
| QB passing yards | 2026 | Last 3 appearances | 76 | 75.395 | 69.189 |
| QB passing yards | 2026 | Last 5 appearances | 76 | 71.816 | 69.189 |
| QB passing yards | 2026 | Season to date | 34 | 84.147 | 73.571 |
| RB rushing yards | 2025 | Last 3 appearances | 1458 | 21.108 | 19.923 |
| RB rushing yards | 2025 | Last 5 appearances | 1388 | 20.728 | 20.050 |
| RB rushing yards | 2025 | Season to date | 1354 | 19.655 | 19.959 |
| RB rushing yards | 2026 | Last 3 appearances | 159 | 23.698 | 22.203 |
| RB rushing yards | 2026 | Last 5 appearances | 154 | 22.761 | 22.349 |
| RB rushing yards | 2026 | Season to date | 70 | 27.871 | 24.351 |
| WR/TE receiving yards | 2025 | Last 3 appearances | 3566 | 19.910 | 18.904 |
| WR/TE receiving yards | 2025 | Last 5 appearances | 3427 | 19.576 | 19.024 |
| WR/TE receiving yards | 2025 | Season to date | 3288 | 19.137 | 18.865 |
| WR/TE receiving yards | 2026 | Last 3 appearances | 405 | 21.937 | 21.218 |
| WR/TE receiving yards | 2026 | Last 5 appearances | 396 | 21.191 | 21.318 |
| WR/TE receiving yards | 2026 | Season to date | 185 | 25.357 | 22.583 |
| WR/TE receptions | 2025 | Last 3 appearances | 3566 | 1.391 | 1.334 |
| WR/TE receptions | 2025 | Last 5 appearances | 3427 | 1.381 | 1.342 |
| WR/TE receptions | 2025 | Season to date | 3288 | 1.339 | 1.326 |
| WR/TE receptions | 2026 | Last 3 appearances | 405 | 1.497 | 1.455 |
| WR/TE receptions | 2026 | Last 5 appearances | 396 | 1.439 | 1.455 |
| WR/TE receptions | 2026 | Season to date | 185 | 1.765 | 1.495 |

## Usage strata using frozen training thresholds

Usage bands use the original frozen model's 2021–2023 training-volume tertiles; no holdout outcomes or holdout quantiles are used to set bands.

| Family | Season | Band | Frozen training volume range | N | Model MAE | Last-3 MAE |
|---|---:|---|---|---:|---:|---:|
| QB passing yards | 2025 | low | —–27.67 | 246 | 73.132 | 78.102 |
| QB passing yards | 2025 | medium | 27.67–34.33 | 228 | 63.280 | 66.906 |
| QB passing yards | 2025 | high | 34.33–— | 145 | 65.829 | 78.120 |
| QB passing yards | 2026 | low | —–27.67 | 38 | 58.085 | 62.456 |
| QB passing yards | 2026 | medium | 27.67–34.33 | 25 | 77.058 | 85.680 |
| QB passing yards | 2026 | high | 34.33–— | 13 | 86.513 | 93.436 |
| RB rushing yards | 2025 | low | —–5.00 | 606 | 12.254 | 10.879 |
| RB rushing yards | 2025 | medium | 5.00–11.67 | 428 | 22.866 | 24.563 |
| RB rushing yards | 2025 | high | 11.67–— | 424 | 27.913 | 32.241 |
| RB rushing yards | 2026 | low | —–5.00 | 55 | 11.260 | 11.024 |
| RB rushing yards | 2026 | medium | 5.00–11.67 | 51 | 24.404 | 25.693 |
| RB rushing yards | 2026 | high | 11.67–— | 53 | 31.440 | 34.931 |
| WR/TE receiving yards | 2025 | low | —–3.00 | 1783 | 12.930 | 12.681 |
| WR/TE receiving yards | 2025 | medium | 3.00–5.33 | 851 | 21.513 | 23.145 |
| WR/TE receiving yards | 2025 | high | 5.33–— | 932 | 27.950 | 30.786 |
| WR/TE receiving yards | 2026 | low | —–3.00 | 187 | 15.791 | 14.975 |
| WR/TE receiving yards | 2026 | medium | 3.00–5.33 | 115 | 22.427 | 23.594 |
| WR/TE receiving yards | 2026 | high | 5.33–— | 103 | 29.722 | 32.725 |
| WR/TE receptions | 2025 | low | —–3.00 | 1783 | 0.964 | 0.920 |
| WR/TE receptions | 2025 | medium | 3.00–5.33 | 851 | 1.526 | 1.604 |
| WR/TE receptions | 2025 | high | 5.33–— | 932 | 1.867 | 2.099 |
| WR/TE receptions | 2026 | low | —–3.00 | 187 | 1.161 | 1.052 |
| WR/TE receptions | 2026 | medium | 3.00–5.33 | 115 | 1.634 | 1.748 |
| WR/TE receptions | 2026 | high | 5.33–— | 103 | 1.788 | 2.026 |

## Frozen artifact and leakage assertions

- All predictions have cutoffs strictly before scheduled kickoff (structural game-time chronology): **true**.
- All holdout predictions use scheduled UTC kickoffs (structural game-time chronology): **true**.
- Player and team feature history is strictly earlier than the target cutoff (structural game-time chronology): **true**.

These true flags establish structural ordering against the available game-time fields only; they do not prove when the original stat or schedule sources were published.

| Family | Frozen model version | Fitted artifact SHA-256 | Training examples SHA-256 | Frozen usage tertiles |
|---|---|---|---|---|
| qbPassingYards | gridline-player-projection-historical-v1-qbPassingYards-99a76f3d51c05a52 | `8566aaee493f10a0e7d286bd0c99550ab0f989d1bb1a4ba61d5391fbddfb5784` | `99a76f3d51c05a5242cfb444f795c866c87bb3c66afab6fff1da6b4e6c45f2c2` | 27.667, 34.333 |
| rbRushingYards | gridline-player-projection-historical-v1-rbRushingYards-8dcacc948d62ab2d | `e9442c57889c8c7f6fd5e9bd57728083ec312ad68f4b1d75165d0e50442fa187` | `8dcacc948d62ab2da422644dde8c0b6747494272bb6749165df4a421c9108f9f` | 5.000, 11.667 |
| receiverReceivingYards | gridline-player-projection-historical-v1-receiverReceivingYards-81ea706c45e5e847 | `bd88929c829d33c3f71e50e1826028245d13f3ca045a66b59305186b656aec50` | `81ea706c45e5e847b674f7d152cb859d7d29cf9f81bbca5db1c17a641e2df461` | 3.000, 5.333 |
| receiverReceptions | gridline-player-projection-historical-v1-receiverReceptions-3ccc5015c0763691 | `0b0550f02d8f22146ae47295908aeb3bbfa8f333ed9ccbf68c3ef659fd952458` | `3ccc5015c076369187aff25dd03212f9a1b836faafc01a342d492bce895006ed` | 3.000, 5.333 |

## Source coverage and caveats

- Development database only; raw player-stat rows: **27846**; reconciled player-game rows: **27837**; lagged team-game rows: **2900**.
- Schedule rows: **1496**; unique matched player-game schedule IDs: **1392**.
- Unmatched/ambiguous player rows: **9**; non-final schedule rows excluded: **46**.
- Raw player-stat rows by season: 2021: 5298; 2022: 5252; 2023: 5294; 2024: 5227; 2025: 6037; 2026: 738.
- Reconciled player-game rows by season: 2021: 5296; 2022: 5252; 2023: 5289; 2024: 5225; 2025: 6037; 2026: 738.
- Schedule time mode by season: 2021: team_game_calendar_date_fallback; 2022: team_game_calendar_date_fallback; 2023: team_game_calendar_date_fallback; 2024: team_game_calendar_date_fallback; 2025: explicit_final_schedule_kickoff_only; 2026: explicit_final_schedule_kickoff_only.

### Recovered source ledger

| Source | Season | URL / run identity | Status | Rows / records | File size | Completed at |
|---|---:|---|---|---:|---:|---|
| NFLverse player_stats | 2025 | https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv.gz | success | 19422 | 1262421 bytes | 2026-09-26T15:01:39.759Z |
| NFLverse player_stats | 2026 | https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz | success | 2294 | 150127 bytes | 2026-09-26T15:01:51.775Z |
| ESPN schedule recovery | — | development-historical-schedule-recovery; run 211 | success | 304 records | — | 2026-09-26T15:02:12.810Z |
| ESPN schedule recovery | — | development-historical-schedule-week3-atl-gb; run 212 | success | 1 record | — | 2026-09-26T15:07:34.578Z |

The source ledger records imported file metadata and the persisted ESPN schedule-recovery runs for the historical recovery and week-3 ATL–GB update. No upstream NFLverse file-content digest was available in the source metadata.

### Final-game and player-row coverage by season/week

| Season:week | Explicitly final schedule games | Final games with valid kickoff | Matched player rows |
|---|---:|---:|---:|
| 2025:1 | 16 | 16 | 355 |
| 2025:2 | 16 | 16 | 350 |
| 2025:3 | 16 | 16 | 354 |
| 2025:4 | 16 | 16 | 355 |
| 2025:5 | 14 | 14 | 318 |
| 2025:6 | 15 | 15 | 321 |
| 2025:7 | 15 | 15 | 338 |
| 2025:8 | 13 | 13 | 291 |
| 2025:9 | 14 | 14 | 313 |
| 2025:10 | 14 | 14 | 312 |
| 2025:11 | 15 | 15 | 332 |
| 2025:12 | 14 | 14 | 311 |
| 2025:13 | 16 | 16 | 349 |
| 2025:14 | 14 | 14 | 326 |
| 2025:15 | 16 | 16 | 344 |
| 2025:16 | 16 | 16 | 363 |
| 2025:17 | 16 | 16 | 355 |
| 2025:18 | 16 | 16 | 350 |
| 2026:1 | 16 | 16 | 357 |
| 2026:2 | 16 | 16 | 359 |
| 2026:3 | 1 | 1 | 22 |
| 2026:4 | 0 | 0 | 0 |
| 2026:5 | 0 | 0 | 0 |

- Input checksum SHA-256: `018a040f8111561cf57be41f8964c40e39e764e6444f2b08e233f3d89464eec9`.
- Sources: player_game_stats (nflverse, regular season, 2021–2026); games (2025–2026 rows require explicit final/complete status and scheduled UTC kickoff); team_game_stats (lagged team pass-rate and opponent defensive context where available); teams (schedule-ID to abbreviation mapping); team_game_stats date-only schedule fallback permitted for 2021–2024 history only.
- Game-time ordering is enforced, but archived source-publication timestamps were not verified. 2021–2024 history may use conservative date-only boundaries; 2025–2026 scored observations require an explicitly final/complete game with a scheduled UTC kickoff. Outcomes from games still in progress or not explicitly final are excluded even if score columns are non-null.

Only explicit final/complete status qualifies a 2025–2026 schedule game for evaluation; score columns, including 0–0, do not establish finality. Non-final schedule entries are excluded from both scored outcomes and lagged team context. Historical 2021–2024 history may use conservative date-only boundaries. ESPN kickoff timestamps are presently reported scheduled kickoffs normalized to UTC, not independently archived original pregame schedule snapshots. Archived stat source-publication timestamps were not independently verified, so game-time chronology does not prove historical source availability.

Metric confidence intervals are descriptive normal-approximation intervals; they measure uncertainty in mean metrics, not individual projection uncertainty. Missing target rows are not synthesized as zero production. Player game rows are observed stat lines, not complete roster participation records.

## Upcoming projection readiness

**NOT READY** — no upcoming-game forecasts have been generated or published.

- No verified as-of publication/freshness evidence for each player and team input at an upcoming calculation timestamp.
- The recorded player-game stat lines do not establish upcoming player participation, team assignment, injury status, or starter eligibility.
- This evaluator requires a completed target-game outcome for scoring; it does not generate or validate future-game inference inputs.

## Sample validation rows

| Family | Season | Player | Matchup | Kickoff | Cutoff | Projection | Actual | Prior appearances |
|---|---:|---|---|---|---|---:|---:|---:|
| qbPassingYards | 2025 | Dak Prescott (00-0033077) | DAL vs PHI | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 210.141 | 188.000 | 53 |
| qbPassingYards | 2025 | Jalen Hurts (00-0036389) | PHI vs DAL | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 185.370 | 152.000 | 62 |
| rbRushingYards | 2025 | Saquon Barkley (00-0034844) | PHI vs DAL | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 78.958 | 60.000 | 59 |
| rbRushingYards | 2025 | Miles Sanders (00-0035243) | DAL vs PHI | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 29.159 | 53.000 | 56 |
| receiverReceivingYards | 2025 | Dallas Goedert (00-0034351) | PHI vs DAL | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 36.358 | 44.000 | 51 |
| receiverReceivingYards | 2025 | A.J. Brown (00-0035676) | PHI vs DAL | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 56.005 | 8.000 | 60 |
| receiverReceptions | 2025 | Dallas Goedert (00-0034351) | PHI vs DAL | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 3.097 | 7.000 | 51 |
| receiverReceptions | 2025 | A.J. Brown (00-0035676) | PHI vs DAL | 2025-09-05T00:20:00.000Z | 2025-09-05T00:19:59.999Z | 4.305 | 1.000 | 60 |
