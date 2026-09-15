# Phase 6.1 Production Release Report

Generated September 14, 2026 after publishing build `3baaf297b31b-2026-09-15T02:33:13.478Z`.

## Release decision

**Published successfully, but NOT SAFE FOR MANUAL PROMOTION.**

The application and production database are healthy. However, publishing did not transfer the three development candidate rows, did not install the custom model-artifact immutability trigger, and did not refresh production Week 2 feature rows. No model was retrained, refit, or promoted during this release.

## 1. Publish result

- Deployment: successful
- Production URL: `https://nfl-analytics-model.replit.app`
- Deployment type: VM
- Visibility: private
- Production health endpoint: passed after startup
- API and durable worker: running

## 2. Production database smoke

**PASSED — 7/7 checks**

The published startup smoke check and the post-publish `production-db-smoke` workflow both passed.

## 3. Migration result

**FAILED RELEASE REQUIREMENT**

- Destructive schema diff: none
- Structural data loss: none
- `model_training_runs_artifact_immutable` trigger in production: absent
- `reject_model_artifact_mutation()` function in production: absent

The project migration runner is intentionally development-only. Replit Publish did not execute the custom trigger migration.

## 4–6. Production artifact verification

| Family | Expected artifact ID | Expected SHA-256 | Production result |
|---|---|---|---|
| Spread | `phase6-1-spread-01c85917b47c6e70c258fe0258481c7a` | `01c85917b47c6e70c258fe0258481c7a2a21e567c95db02cac38988baa4034bf` | **Absent** |
| Moneyline | `phase6-1-moneyline-917fa6e7417cccb45909ade470c997d0` | `917fa6e7417cccb45909ade470c997d0841fe8a010bc18899f4b5b913be4d6ae` | **Absent** |
| Totals | `phase6-1-totals-749279b5856f1be1165c211d3c6233c7` | `749279b5856f1be1165c211d3c6233c7c4f55d44d12ebcb2c94500db63b60c2f` | **Absent** |

Because the rows are absent, production cannot verify their checksums, load their exact feature ordering, or perform deterministic artifact inference.

## 7. Artifact immutability

**NOT ACTIVE IN PRODUCTION**

Production read-only catalog inspection found no non-internal trigger on `model_training_runs`. Mutation and deletion protection therefore cannot be confirmed and must be treated as unavailable.

## 8. Legacy model status

- Historical production promotion records preserved: **6**
- Phase 6.1 production promotions: **0**
- Phase 6.1 candidate-linked snapshots: **0**
- Production rows marked `legacy_unverifiable_artifact`: **0**

Legacy promotion history remains preserved, but production does not contain the development-side legacy status classifications.

## 9. Week 2 input readiness

All 16 upcoming Week 2 games have valid game/team identity pairing, but their production `pregame-v3` rows contain only the two low-sample indicator inputs. Each is missing the 24 selected football differences plus QB confidence, and each persisted source cutoff is not currently cutoff-safe.

| Game ID | Matchup | Required | Populated | Missing | QB confidence | Provenance | Cutoff safe | Vector reconstructs | Eligible after promotion |
|---|---|---:|---:|---:|---|---|---|---|---|
| 401872932 | DET at BUF | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872933 | CAR at ATL | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872934 | CIN at HOU | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872935 | CLE at TB | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872936 | GB at NYJ | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872937 | MIN at CHI | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872938 | NO at BAL | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872939 | PHI at TEN | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872946 | PIT at NE | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872940 | JAX at DEN | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872941 | LV at LAC | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872942 | MIA at SF | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872943 | SEA at ARI | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872944 | WSH at DAL | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872945 | IND at KC | 27 | 2 | 25 | unavailable | valid | No | No | No |
| 401872947 | NYG at LAR | 27 | 2 | 25 | unavailable | valid | No | No | No |

No prediction was generated.

## 10–12. Promotion recommendations

- Spread: **NOT SAFE FOR MANUAL PROMOTION**
- Moneyline: **NOT SAFE FOR MANUAL PROMOTION**
- Totals: **NOT SAFE FOR MANUAL PROMOTION**

Each family fails the production-artifact, immutability, and Week 2 input-readiness requirements.

## 13. Automatic-promotion confirmation

- Automatic promotion occurred: **No**
- Manual promotion occurred: **No**
- Consumer-visible candidate predictions were created: **No**
- Historical prediction or sportsbook records were altered: **No**

## Required remediation

Do not promote any candidate. A separate release must establish a supported, non-destructive production import path for the already-fitted artifacts, install equivalent production immutability enforcement through a supported mechanism, and refresh legitimate production `pregame-v3` Week 2 rows. It must not retrain or refit the candidates and must preserve production promotion, prediction, and sportsbook history.