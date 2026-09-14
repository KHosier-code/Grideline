# Gridline Phase 4 Model Training Audit

Generated from the persisted `pregame-v3` walk-forward runs.

## 1. Algorithms tested

Separate model families were evaluated:

- **Spread / ATS projected margin:** regularized linear regression, random forest regression, and gradient boosting regression.
- **Moneyline home-win probability:** regularized logistic regression, random forest classification, and gradient boosting classification.
- **Game totals projected total:** regularized linear regression, random forest regression, and gradient boosting regression.

The gradient boosting implementation is a deterministic boosted-tree equivalent. No separate XGBoost package was available in the application runtime.

## 2. Seasons used

Training began with 2021 and expanded chronologically:

- Train 2021 → test 2022
- Train 2021–2022 → test 2023
- Train 2021–2023 → test 2024
- Train 2021–2024 → test 2025
- Historical training → test 2026 where completed scores existed

2026 was not used to select the historical production candidates because it has only 10 completed games in the current dataset. It remains visible as an out-of-sample current-season evaluation period.

## 3. Number of predictions evaluated

- 1,434 completed games supplied normalized final scores.
- 81 persisted model-training runs were created.
- Historical candidate selection used 1,139 moneyline/spread/total test observations for the include-low-sample policy and 947 for the restricted policy, depending on the family.
- 2026 evaluations contain 10 completed games.

## 4. Recommended review candidates

These are recommendations for review only. None is active.

### Spread

- Algorithm: regularized linear regression
- Sample policy: include low-sample observations
- Historical average across 2022–2025:
  - MAE: **9.997 points**
  - RMSE: **13.013 points**
  - Test observations: **1,139**

### Moneyline

- Algorithm: logistic regression
- Sample policy: include low-sample observations
- Historical average across 2022–2025:
  - Accuracy: **60.6%**
  - Log loss: **0.652**
  - Brier score: **0.231**
  - Test observations: **1,139**

### Totals

- Algorithm: gradient boosting
- Sample policy: exclude low-sample observations
- Historical average across 2022–2025:
  - MAE: **10.744 points**
  - RMSE: **13.764 points**
  - Test observations: **947**

The selections use multi-season historical averages rather than the best single fold or highest raw win rate.

## 5. Best model by test season

### Spread

| Test season | Candidate | Policy | MAE |
|---|---|---|---:|
| 2022 | Linear regression | Exclude low sample | 8.962 |
| 2023 | Linear regression | Include low sample | 10.483 |
| 2024 | Linear regression | Exclude low sample | 10.213 |
| 2025 | Linear regression | Include low sample | 10.198 |
| 2026 | Linear regression | Include low sample | 10.333 |

### Moneyline

| Test season | Candidate | Policy | Accuracy | Log loss | Brier |
|---|---|---|---:|---:|---:|
| 2022 | Random forest | Include low sample | 63.0% | 0.662 | 0.235 |
| 2023 | Logistic regression | Include low sample | 59.3% | 0.648 | 0.229 |
| 2024 | Random forest | Exclude low sample | 64.6% | 0.636 | 0.223 |
| 2025 | Logistic regression | Include low sample | 61.8% | 0.634 | 0.222 |
| 2026 | Logistic regression | Include low sample | 50.0% | 0.612 | 0.213 |

The 2026 log loss is not treated as a promotion signal because it is based on only 10 games.

### Totals

| Test season | Candidate | Policy | MAE | RMSE |
|---|---|---|---:|---:|
| 2022 | Random forest | Include low sample | 11.040 | 13.850 |
| 2023 | Gradient boosting | Include low sample | 10.753 | 13.715 |
| 2024 | Linear regression | Exclude low sample | 10.082 | 13.513 |
| 2025 | Gradient boosting | Exclude low sample | 10.881 | 13.806 |
| 2026 | Random forest | Include low sample | 17.723 | 21.729 |

## 6. Calibration

Moneyline probabilities are evaluated with out-of-sample calibration buckets:

- 50–54%
- 55–59%
- 60–64%
- 65–69%
- 70%+

The Model Lab displays predicted probability, observed win rate, number of predictions, and bucket gap. The current models mostly populate the 50–64% ranges; the higher-confidence buckets remain sparse or empty. No calibration method was applied automatically because the existing out-of-sample sample does not justify adding Platt or isotonic calibration without another validation layer.

## 7. Most influential features

The strongest recurring features in the persisted candidate runs are:

- Last-8 EPA per play
- Last-8 offensive success rate
- Last-8 yards per play
- Last-3 red-zone touchdown rate
- Last-5 defensive success rate
- Last-3/5/8 turnover rate
- Last-3/5 explosive pass rate

Feature importance is shown in the Model Lab. Low initial importance does not automatically remove a feature from future retraining.

## 8. Low-sample games

Both policies were tested:

1. Include low-sample rows with explicit low-sample flags.
2. Restrict rows where either team had a low-sample feature state.

The include policy performed better for the selected spread and moneyline candidates. The restricted policy performed better for totals. Early-season games were not silently discarded; the policy and resulting sample size are recorded on every run.

## 9. QB-confidence uncertainty

The feature vector includes QB continuity, starter-change state, and QB data confidence. Model evaluation also stores low-QB-confidence and high-QB-confidence error fields where those groups are populated.

QB features are inferred from prior primary-participation evidence, not treated as perfect official starter certainty. This is a limitation of historical participation data and remains visible in the feature version rather than being hidden as a hard certainty.

## 10. Overfitting review

There are no signs that justify promoting a complex model over the simple baselines:

- Linear regression is the best spread candidate on the historical average.
- Logistic regression is the best moneyline candidate on historical average log loss.
- Gradient boosting is preferred for totals, but the improvement over linear regression is modest.
- 2026 results are small and are not used for candidate selection.
- No random train/test split or betting-result tuning was used.

The model errors are materially non-trivial, so these results should not be presented as a guaranteed betting edge.

## 11. Historical sportsbook limitation

Complete, reliable pre-prediction DraftKings/FanDuel lines are not available for the historical feature sample. Therefore:

- ATS cover-probability Brier scores are unavailable.
- Historical Over/Under probability quality is unavailable.
- ATS win rate, ROI, CLV, and similar betting-performance metrics are not inferred.
- No historical sportsbook lines were fabricated from current odds.

The Model Lab and API expose this as unavailable rather than zero.

## 12. Production/challenger workflow

The API stores each training run as a challenger record with its feature version, algorithm, training seasons, test season, sample policy, metrics, calibration, and feature importance.

The current state is:

- Production candidate: none activated
- Challenger A: available for review
- Challenger B: available for review
- Automatic promotion: disabled

An administrator must explicitly promote a candidate in a later workflow. The training endpoint itself is administrator-protected.

## 13. Scope confirmation

This phase did not add:

- Subjective AI overrides
- Final confidence scores
- Recommended bet sizing
- Kelly staking
- Player props
- Anytime touchdown models
- Automated wagering

No fake historical sportsbook predictions were generated.