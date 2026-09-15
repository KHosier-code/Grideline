# Gridline Phase 6.1 Artifact Recovery Report

Generated September 14, 2026. Development recovery only.

## Result

Three immutable, independently loadable `pregame-v3` candidates were trained from NFL seasons 2021–2025 only. Season 2026 examples were detected and excluded from fitting. No candidate was promoted and no consumer prediction or candidate-linked prediction snapshot was written.

The exact training cutoff is `2026-02-08T12:00:00.000Z`. This is a calendar date in 2026 because the 2025 NFL season ends in February 2026; every fitted example still has `season = 2025` or earlier.

## Candidate artifacts

| Family | Approved configuration | Training samples | Artifact ID | SHA-256 checksum |
|---|---|---:|---|---|
| Spread | regularized linear regression; include low-sample | 1,408 | `phase6-1-spread-01c85917b47c6e70c258fe0258481c7a` | `01c85917b47c6e70c258fe0258481c7a2a21e567c95db02cac38988baa4034bf` |
| Moneyline | logistic regression; include low-sample | 1,408 | `phase6-1-moneyline-917fa6e7417cccb45909ade470c997d0` | `917fa6e7417cccb45909ade470c997d0841fe8a010bc18899f4b5b913be4d6ae` |
| Totals | gradient boosting; exclude low-sample | 1,152 | `phase6-1-totals-749279b5856f1be1165c211d3c6233c7` | `749279b5856f1be1165c211d3c6233c7c4f55d44d12ebcb2c94500db63b60c2f` |

## Exact feature schema

All three artifacts use the same ordered 27-value vector and schema fingerprint:

`d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42`

1. `last_3.defensive_success_rate`
2. `last_3.epa_per_play`
3. `last_3.explosive_pass_rate`
4. `last_3.explosive_rush_rate`
5. `last_3.offensive_success_rate`
6. `last_3.red_zone_touchdown_rate`
7. `last_3.turnover_rate`
8. `last_3.yards_per_play`
9. `last_5.defensive_success_rate`
10. `last_5.epa_per_play`
11. `last_5.explosive_pass_rate`
12. `last_5.explosive_rush_rate`
13. `last_5.offensive_success_rate`
14. `last_5.red_zone_touchdown_rate`
15. `last_5.turnover_rate`
16. `last_5.yards_per_play`
17. `last_8.defensive_success_rate`
18. `last_8.epa_per_play`
19. `last_8.explosive_pass_rate`
20. `last_8.explosive_rush_rate`
21. `last_8.offensive_success_rate`
22. `last_8.red_zone_touchdown_rate`
23. `last_8.turnover_rate`
24. `last_8.yards_per_play`
25. `home_low_sample`
26. `away_low_sample`
27. `qb_confidence_difference`

Missing, non-finite, wrong-width, wrong-order, and checksum-invalid inputs fail closed.

## Historical 2025 comparison

The new artifacts are not claimed to be identical to the unpreserved legacy models.

| Family | New 2025 holdout | Retained reference | Classification |
|---|---|---|---|
| Spread | MAE 10.1992; RMSE 13.2400; 285 games | MAE 10.1982; RMSE 13.2414; 285 games | Materially consistent |
| Moneyline | Accuracy 61.7544%; log loss 0.633855; Brier 0.222487; 285 games | Accuracy 61.7544%; log loss 0.633853; Brier 0.222487; 285 games | Materially consistent |
| Totals | MAE 10.8809; RMSE 13.8065; 237 games | MAE 10.8809; RMSE 13.8065; 237 games | Materially consistent |

Classification uses a 10% relative band for error/loss metrics and a 2.5 percentage-point band for moneyline accuracy.

## Validation

- Focused artifact, promotion, prediction-safety, and chronology tests: **38/38 passed**
- Official prediction-safety workflow: **18/18 prediction checks passed**
- Official chronology/leakage workflow: **7/7 checks passed**
- Workspace typecheck: **passed**
- Artifact checksum verification: **passed for all three**
- Independent deterministic inference: **passed**
- Exact 2021–2025 season requirement: **enforced**
- PostgreSQL artifact mutation, evidence mutation, and deletion rejection: **verified**
- Final architecture review: **no blocking or high-risk findings**

## Upcoming-game readiness and shadow predictions

The refreshed `pregame-v3` set contains 32 upcoming games and 64 paired team rows with valid generated-before-kickoff cutoffs. The six reported shadows each populated all 27 required values, missed zero values, had explicit QB confidence, and used distinct vectors.

| Matchup | Populated | Missing | QB confidence | Projected margin | Projected total | Home win probability | Input quality |
|---|---:|---:|---:|---:|---:|---:|---|
| DET at BUF | 27 | 0 | 1.0 | 4.267 | 45.511 | 52.36% | complete_verified |
| CIN at HOU | 27 | 0 | 1.0 | -0.189 | 44.817 | 39.65% | complete_verified |
| GB at NYJ | 27 | 0 | 1.0 | -6.182 | 44.509 | 19.97% | complete_verified |
| CLE at TB | 27 | 0 | 1.0 | 5.684 | 45.488 | 63.18% | complete_verified |
| NO at BAL | 27 | 0 | 1.0 | 4.138 | 44.693 | 48.72% | complete_verified |
| PHI at TEN | 27 | 0 | 1.0 | -2.857 | 45.488 | 27.86% | complete_verified |

Shadow writes: `prediction_snapshots = 0`; consumer predictions = `0`.

## Promotion status

All three candidates satisfy the implemented manual-promotion gates after checksum, schema, historical comparison, safety, chronology, and six-game current-inference validation. Promotion still requires an explicit administrator action, and the promotion endpoint reruns current-game inference and safety before the atomic promotion insert.

- Automatic promotion occurred: **No**
- Production promotion-history rows deleted or modified: **No**
- Candidate-linked prediction snapshots: **0**
- Legacy promoted training runs marked `legacy_unverifiable_artifact`: **6**
- Legacy promotion and prediction history preserved: **Yes**
- Consumer exposure before explicit promotion: **No**