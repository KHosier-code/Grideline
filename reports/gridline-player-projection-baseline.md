# Gridline Player Projection Baseline

**Status:** historical simulation — not live projections  
**Generated:** 2026-09-26T14:30:19.423Z  
**Training seasons:** 2021, 2022, 2023  
**Chronological evaluation season:** 2024  
**Prediction cutoff:** one millisecond before the available game-time boundary; date-only fallbacks exclude all same-day evidence  
**Model version:** gridline-player-projection-historical-v1

This evaluation uses authentic completed 2024 NFL regular-season player stat rows. The development schedule table is empty, so team-game source dates provide a conservative calendar-date boundary; all evidence from the target date is withheld and exact kickoff times remain unavailable. Predictions below are historical simulations, not current or upcoming-game advice.

## Results

| Family | Train rows | Eligible 2024 | Eligible players | Availability | Overall model MAE (95% CI) | Model RMSE | Bias |
|---|---:|---:|---:|---:|---:|---:|---:|
| QB passing yards | 1659 | 636/664 | 74/78 | 95.8% | 66.665 ([62.754, 70.577]) | 83.507 | -1.768 |
| RB rushing yards | 3490 | 1267/1343 | 122/135 | 94.3% | 22.224 ([21.130, 23.318]) | 29.803 | -0.923 |
| WR/TE receiving yards | 8323 | 3031/3218 | 308/345 | 94.2% | 20.932 ([20.254, 21.610]) | 28.290 | -0.412 |
| WR/TE receptions | 8323 | 3031/3218 | 308/345 | 94.2% | 1.478 ([1.431, 1.525]) | 1.980 | -0.079 |

## Paired baseline comparisons

Overall model metrics above use all eligible predictions. Each comparison below uses only evaluation rows where that baseline is available; the baseline and paired-model columns are scored on the exact same player-games. Do not compare a paired baseline MAE with the all-prediction overall model MAE above.

| Family | Baseline | Baseline N | Paired model N | Baseline MAE | Model MAE on same rows |
|---|---|---:|---:|---:|---:|
| QB passing yards | Last 3 appearances | 636 | 636 | 71.269 | 66.665 |
| QB passing yards | Last 5 appearances | 619 | 619 | 70.858 | 66.472 |
| QB passing yards | Season to date | 569 | 569 | 67.463 | 65.981 |
| RB rushing yards | Last 3 appearances | 1267 | 1267 | 23.398 | 22.224 |
| RB rushing yards | Last 5 appearances | 1226 | 1226 | 22.897 | 22.321 |
| RB rushing yards | Season to date | 1164 | 1164 | 23.016 | 22.461 |
| WR/TE receiving yards | Last 3 appearances | 3031 | 3031 | 22.676 | 20.932 |
| WR/TE receiving yards | Last 5 appearances | 2931 | 2931 | 21.999 | 21.055 |
| WR/TE receiving yards | Season to date | 2768 | 2768 | 21.851 | 21.198 |
| WR/TE receptions | Last 3 appearances | 3031 | 3031 | 1.567 | 1.478 |
| WR/TE receptions | Last 5 appearances | 2931 | 2931 | 1.527 | 1.483 |
| WR/TE receptions | Season to date | 2768 | 2768 | 1.547 | 1.506 |

Metric confidence intervals are descriptive normal-approximation 95% intervals over per-player-game absolute errors, squared errors, and signed errors. They quantify uncertainty in the measured mean metric, not uncertainty for an individual forecast. Missing target rows are not synthesized as zero production.
Bias is projected statistic minus actual statistic; positive values indicate overprediction. RMSE intervals are obtained by transforming the interval for mean squared error.
Prediction availability is eligible predictions divided by matched 2024 player-game rows with a recorded target statistic; player IDs counted as eligible are unique GSIS IDs within the family, not a complete active-roster count.

## Model and feature configuration

Regularized linear regression with chronological lagged features: Four independently fitted ridge regressions using only player, team, and opponent observations before each available target-game time boundary. Where only game dates exist, all target-day observations are excluded. Models do not include player IDs, target-game outcomes, sportsbook lines, or future rows.

Minimum prior appearances: **3**. Recent player production is calculated over the prior 3, 5, and 8 recorded appearances where enough history exists. Same-season means, volume/efficiency, team pass rate, opponent defensive EPA allowed, and team rest are included only when their source rows precede the target cutoff.

Continuous features are standardized from training examples only; missing-feature indicators are fitted separately. Each market family is trained independently on 2021–2023. Usage bands use prior target-relevant volume terciles estimated only from the training split.

### Usage-level holdout results

| Family | Usage band | Thresholds from training | N | Model MAE | Last-3 MAE |
|---|---|---|---:|---:|---:|
| QB passing yards | low | —–27.67 | 260 | 70.789 | 74.182 |
| QB passing yards | medium | 27.67–34.33 | 249 | 65.141 | 67.552 |
| QB passing yards | high | 34.33–— | 127 | 61.212 | 72.596 |
| RB rushing yards | low | —–5.00 | 431 | 15.342 | 15.390 |
| RB rushing yards | medium | 5.00–11.67 | 410 | 21.650 | 22.572 |
| RB rushing yards | high | 11.67–— | 426 | 29.738 | 32.296 |
| WR/TE receiving yards | low | —–3.00 | 1202 | 14.375 | 14.401 |
| WR/TE receiving yards | medium | 3.00–5.33 | 880 | 22.306 | 24.054 |
| WR/TE receiving yards | high | 5.33–— | 949 | 27.964 | 31.878 |
| WR/TE receptions | low | —–3.00 | 1202 | 1.070 | 1.081 |
| WR/TE receptions | medium | 3.00–5.33 | 880 | 1.499 | 1.563 |
| WR/TE receptions | high | 5.33–— | 949 | 1.975 | 2.187 |

## Source coverage and reproducibility

- Development database only; raw player-stat rows: **21071**; schedule-reconciled player-game rows: **21062**.
- Schedule-time mode: **team_game_calendar_date_fallback**; 1087 player-matched games from 1139 schedule/proxy-game rows; lagged team-game rows: **2278**.
- Player-stat rows without a unique schedule/team/opponent match: **9**; schedule rows excluded as non-final: **0**.
- Matched player-game rows by season: 2021: 5296; 2022: 5252; 2023: 5289; 2024: 5225.
- Input SHA-256: `5e328f8e5749ede65011874867f4763b3fda7f1d89ce645b4de7bca36fda2dae`.
- Source tables: player_game_stats (nflverse, regular season, 2021–2024); team_game_stats game dates used as a conservative calendar-date schedule fallback; all same-day evidence withheld; team_game_stats (lagged team pass-rate and opponent defensive context where available); teams (schedule-ID to abbreviation mapping).
- Game-time ordering uses scheduled kickoffs when available; otherwise same-day evidence is withheld using a calendar-date boundary. Archived source-publication timestamps were not verified.

The source table records an import/update timestamp but does not supply an independently verified historical publication timestamp for every stat line. This report therefore enforces game-time chronology and labels its outputs historical simulations; it does not claim that the original source publication itself was captured before every 2024 cutoff.

## Historical projection examples

Every row below is a genuine historical 2024 simulation. The calculation timestamp is one millisecond before its reported schedule-time boundary; for the date-only fallback it is before the start of the game date, with all same-day evidence withheld. No row is a live projection.

| Family | Player | Matchup | Game date / kickoff | Cutoff | Basis | Projection | Actual | Prior appearances | Quality | Warnings |
|---|---|---|---|---|---|---:|---:|---:|---|---|
| QB passing yards | Patrick Mahomes (00-0033873) | KC vs BAL | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 219.231 | 291.000 | 50 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| QB passing yards | Lamar Jackson (00-0034796) | BAL vs KC | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 209.693 | 273.000 | 40 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| QB passing yards | Jordan Love (00-0036264) | GB vs PHI | 2024-09-06T00:00:00.000Z / kickoff unavailable | 2024-09-05T23:59:59.999Z | calendar_date_boundary | 218.214 | 260.000 | 27 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| RB rushing yards | Derrick Henry (00-0032764) | BAL vs KC | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 58.990 | 46.000 | 41 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| RB rushing yards | Samaje Perine (00-0033526) | KC vs BAL | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 22.222 | 0.000 | 48 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| RB rushing yards | Justice Hill (00-0034975) | BAL vs KC | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 25.007 | 3.000 | 29 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| WR/TE receiving yards | Travis Kelce (00-0030506) | KC vs BAL | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 39.782 | 34.000 | 48 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| WR/TE receiving yards | Nelson Agholor (00-0031549) | BAL vs KC | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 25.616 | 6.000 | 44 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| WR/TE receiving yards | JuJu Smith-Schuster (00-0033857) | KC vs BAL | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 29.469 | 0.000 | 32 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| WR/TE receptions | Travis Kelce (00-0030506) | KC vs BAL | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 3.509 | 3.000 | 48 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| WR/TE receptions | Nelson Agholor (00-0031549) | BAL vs KC | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 2.474 | 1.000 | 44 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |
| WR/TE receptions | JuJu Smith-Schuster (00-0033857) | KC vs BAL | 2024-09-05T00:00:00.000Z / kickoff unavailable | 2024-09-04T23:59:59.999Z | calendar_date_boundary | 2.634 | 0.000 | 32 | high | Feature unavailable before cutoff: seasonToDateTargetMean; Feature unavailable before cutoff: teamSeasonPassRate; Feature unavailable before cutoff: opponentSeasonDefensiveEpaAllowed; Feature unavailable before cutoff: teamRestDays; No prior team pass-rate data was available.; No prior opponent defensive-efficiency data was available. |

## Limitations

- 2024 outputs are historical simulations, not live or future-game predictions.
- The source extract's original publication timestamp is not independently archived; only game-time chronology is enforced.
- Player game rows represent recorded stat lines; unrecorded non-appearances are not synthesized as zero outcomes.
- No player identity features are fitted, and career history is grouped by source GSIS player ID.
- Prediction intervals and betting profitability are not inferred from these point-forecast metrics.
- Team and opponent context is omitted at a row when matching pregame team-game evidence is unavailable.
