# Gridline 2025 Out-of-Sample Model Audit

**Audit date:** September 14, 2026  
**Mode:** Read-only  
**Source:** Gridline production database  
**Mutation performed:** None  

## Executive conclusion

Gridline retains legitimate aggregate 2025 out-of-sample results for Phase 4 walk-forward candidates trained only on 2021–2024 data. Those results support a full-season comparison of MAE/RMSE for spread and totals and accuracy/log loss/Brier score for moneyline.

Gridline does **not** retain the individual 2025 predictions produced by those candidate evaluations. Therefore week-by-week errors, game-by-game predictions, cumulative results, directional breakdowns, best/worst weeks, and prediction-level edge analysis cannot be reconstructed without refitting or regenerating models. This audit does not do that.

Production contains no 2025 sportsbook observations, official prediction snapshots, or prediction grades. ATS, over/under, moneyline betting records, closing-line comparisons, and CLV are unavailable and are not inferred.

The current Phase 6 production models were refit on 2021–2025 data. They are **not** out-of-sample for 2025. Their selected configurations are compared below using the corresponding Phase 4 2025 walk-forward runs trained on 2021–2024.

## 1. Full 2025 season summary

### A. Model prediction accuracy

#### Spread

| Field | Result |
|---|---:|
| Current Phase 6 configuration | Linear regression; include low-sample games |
| Legitimate 2025 OOS comparison run | `phase4-spread-linear_regression-2025-include_low_sample-1789356784858-54` |
| Training seasons | 2021–2024 |
| Games evaluated | 285 |
| MAE | 10.1982 points |
| RMSE | 13.2414 points |
| Mean prediction error / bias | Unavailable — residuals were not retained |
| Median absolute error | Unavailable |
| Within 3 points | Unavailable |
| Within 7 points | Unavailable |
| Directional winner accuracy | Unavailable |

#### Moneyline

| Field | Result |
|---|---:|
| Current Phase 6 configuration | Logistic regression; include low-sample games |
| Legitimate 2025 OOS comparison run | `phase4-moneyline-logistic_regression-2025-include_low_sample-1789356787957-57` |
| Training seasons | 2021–2024 |
| Games evaluated | 285 |
| Correct winners | 176 |
| Incorrect winners | 109 |
| Win-prediction accuracy | 61.7544% |
| Log loss | 0.633853 |
| Brier score | 0.222487 |
| Favorites versus underdogs accuracy | Unavailable |
| Home versus away accuracy | Unavailable |

Persisted calibration data is partial:

| Probability bucket | Stored predictions | Average prediction | Actual rate |
|---|---:|---:|---:|
| 50–54% | 35 | 52.25% | 42.86% |
| 55–59% | 27 | 57.46% | 55.56% |
| 60–64% | 33 | 62.65% | 60.61% |
| 65–69% | 26 | 67.10% | 57.69% |
| 70%+ | 29 | 76.78% | 93.10% |

These persisted buckets contain 150 observations, not all 285 evaluated games. They must not be presented as complete-season calibration.

#### Totals

| Field | Result |
|---|---:|
| Current Phase 6 configuration | Gradient boosting; exclude low-sample games |
| Legitimate 2025 OOS comparison run | `phase4-totals-gradient_boosting-2025-exclude_low_sample-1789356799072-71` |
| Training seasons | 2021–2024 |
| Games evaluated | 237 |
| MAE | 10.8809 points |
| RMSE | 13.8065 points |
| Mean prediction error / bias | Unavailable — residuals were not retained |
| Median absolute error | Unavailable |
| Within 3 points | Unavailable |
| Within 7 points | Unavailable |

### B. Betting record

| Market | Historical 2025 evidence | Record |
|---|---|---|
| Spread | 0 persisted sportsbook rows across 0 games | ATS unavailable |
| Moneyline | 0 persisted sportsbook rows across 0 games | Betting record unavailable |
| Totals | 0 persisted sportsbook rows across 0 games | O/U unavailable |
| Closing lines | No 2025 closing observations | Unavailable |
| CLV | No valid prediction-time and closing-line pair | Unavailable |

A correct projected winner is counted only as model accuracy. It is not treated as a profitable moneyline bet.

## 2. Week-by-week 2025 report

The feature/outcome corpus contains 285 evaluable games across regular-season weeks 1–18 and postseason weeks 19–22. Individual candidate predictions were not retained, so weekly performance metrics are unavailable.

| Stage | Week | Evaluable games | Low-sample games | ML W-L / accuracy | Margin MAE / RMSE / direction | ATS | Total MAE / RMSE | O/U | Prediction averages |
|---|---:|---:|---:|---|---|---|---|---|---|
| Regular season | 1 | 16 | 16 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 2 | 16 | 16 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 3 | 16 | 16 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 4 | 16 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 5 | 14 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 6 | 15 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 7 | 15 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 8 | 13 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 9 | 14 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 10 | 14 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 11 | 15 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 12 | 14 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 13 | 16 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 14 | 14 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 15 | 16 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 16 | 16 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 17 | 16 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Regular season | 18 | 16 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Postseason | 19 | 6 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Postseason | 20 | 4 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Postseason | 21 | 2 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |
| Postseason | 22 | 1 | 0 | Unavailable | Unavailable | Historical market unavailable | Unavailable | Historical market unavailable | Unavailable |

Sample quality is stored only as a binary low-sample flag. A high/medium/low breakdown was not retained.

## 3. Game-by-game audit

**Unavailable.**

The 2025 feature and outcome rows exist, but the evaluated candidate's per-game projected margin, projected total, and home win probability were not persisted. Creating those values now would require reconstructing/refitting the model and generating predictions, which this audit explicitly prohibits.

Production evidence:

- 285 games have score outcomes available to the model evaluation corpus.
- 0 2025 official prediction snapshots exist.
- 0 2025 prediction grades exist.
- 0 2025 sportsbook observations exist.

No game row is fabricated from aggregate model metrics.

## 4. Cumulative weekly performance

**Unavailable.**

Cumulative moneyline accuracy, directional accuracy, margin MAE, and total MAE require the missing per-game prediction sequence. Cumulative ATS and O/U additionally require historical market lines, which are absent.

## 5. Edge-bucket analysis

**Unavailable.**

There are no legitimate 2025 spread, total, or no-vig moneyline observations in Gridline. Model-versus-market edge buckets cannot be constructed.

## 6. Best and worst weeks

**Unavailable.**

Best/worst moneyline, margin-MAE, total-MAE, ATS, and O/U weeks cannot be identified from full-season aggregate metrics.

## 7. Model comparison

### Spread candidates

| Algorithm | Sample policy | Games | MAE | RMSE | Compared with Phase 6 choice |
|---|---|---:|---:|---:|---|
| Linear regression | Include low sample | 285 | **10.1982** | **13.2414** | Selected configuration; best MAE and RMSE |
| Linear regression | Exclude low sample | 237 | 10.4220 | 13.3963 | Higher error |
| Random forest | Include low sample | 285 | 10.5208 | 13.6869 | Higher error |
| Gradient boosting | Include low sample | 285 | 10.5706 | 13.7193 | Higher error |
| Gradient boosting | Exclude low sample | 237 | 10.7653 | 13.8721 | Higher error |
| Random forest | Exclude low sample | 237 | 10.7797 | 13.7904 | Higher error |

No stored 2025 spread candidate outperformed the Phase 6 configuration on MAE or RMSE.

### Moneyline candidates

| Algorithm | Sample policy | Games | Accuracy | Log loss | Brier |
|---|---|---:|---:|---:|---:|
| Logistic regression | Include low sample | 285 | 61.75% | **0.633853** | **0.222487** |
| Logistic regression | Exclude low sample | 237 | 62.87% | 0.645330 | 0.227979 |
| Random forest | Include low sample | 285 | **63.51%** | 0.649426 | 0.228778 |
| Random forest | Exclude low sample | 237 | 61.60% | 0.662501 | 0.235151 |
| Gradient boosting | Exclude low sample | 237 | 58.23% | 0.666506 | 0.236904 |
| Gradient boosting | Include low sample | 285 | 61.75% | 0.666814 | 0.236990 |

Random forest with low-sample games included had higher raw accuracy than the selected logistic configuration: 63.51% versus 61.75%. It did **not** outperform the selected configuration on log loss or Brier score. The selected logistic configuration had the best probability-quality metrics.

### Totals candidates

| Algorithm | Sample policy | Games | MAE | RMSE | Compared with Phase 6 choice |
|---|---|---:|---:|---:|---|
| Gradient boosting | Exclude low sample | 237 | **10.8809** | **13.8065** | Selected configuration; best MAE and RMSE |
| Random forest | Exclude low sample | 237 | 10.9409 | 13.9534 | Higher error |
| Linear regression | Exclude low sample | 237 | 10.9568 | 13.8601 | Higher error |
| Gradient boosting | Include low sample | 285 | 11.0481 | 13.8518 | Higher error |
| Linear regression | Include low sample | 285 | 11.0647 | 13.8798 | Higher error |
| Random forest | Include low sample | 285 | 11.1230 | 14.0437 | Higher error |

No stored 2025 totals candidate outperformed the Phase 6 configuration on MAE or RMSE.

## 8. Honest limitations

| Question | Answer |
|---|---|
| Do historical 2025 spread lines exist? | No |
| Do historical 2025 total lines exist? | No |
| Do historical 2025 moneyline prices exist? | No |
| Do 2025 closing lines exist? | No |
| Can 2025 CLV be calculated legitimately? | No |
| Are individual 2025 candidate predictions retained? | No |
| Are aggregate 2025 OOS run metrics retained? | Yes |
| Were 2025 games excluded from the selected spread/moneyline OOS runs? | No; 285 evaluable games |
| Were games excluded from the selected totals OOS run? | Yes; 48 low-sample games, leaving 237 |
| Are any weeks excluded from the include-low-sample evaluation corpus? | No; weeks 1–22 are represented |
| Can missing per-game metrics be reconstructed read-only? | No; reconstruction would require fitting and prediction generation |

## Acceptance statement

This report is a faithful read-only audit of what Gridline actually retained. It does not claim betting performance where no market history exists, does not treat accuracy as profitability, and does not regenerate missing predictions.