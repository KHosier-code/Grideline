# Gridline 2025 Market Baseline Audit

**Run:** `phase6-1-2025-market-baseline-v4-bc87373a5d1a-f289a18f99c4`
**Evaluation mode:** append-only, evaluation-only  
**Model features:** `pregame-v3` only  
**Training:** 2021–2024 only  
**Test season:** 2025 only  
**Production models or snapshots changed:** No

The complete machine-readable report, including every weekly and cumulative
metric, is retained in `reports/gridline-2025-market-baseline.json`.

## Source qualification

The retained source is `nflverse/nfldata` `games.csv`, SHA-256
`bc87373a5d1a578ac07c71cb6a1e50a381d58fae393021b96853a4b8674ae8b8`.
The repository publicly distributes the data; upstream NFL data remains subject
to its respective owners' terms. Its dictionary describes `spread_line` and
`total_line` as game lines but does not call them closing lines. Gridline
therefore stores every value as **source-designated recorded**, never verified
closing.

The source supplies home/away moneyline prices, spread prices, totals prices,
week, date, teams, scores, and neutral-site status. It does not identify the
sportsbook or observation timestamp. Those values remain unavailable.

Before any audit rerun loads models or writes results, an automated qualification
check requires the recorded `games.csv` schema, exactly 285 events across weeks
1–22 of the 2025 season, and the reviewed `DATASETS.md` Games and `README.md`
documentation fingerprints. Any column, coverage, line-designation, timing,
sportsbook, licensing, or provenance documentation change stops the rerun with
a review-required diagnostic. Passing this check preserves the
**source-designated recorded** classification; it never upgrades these values to
verified closing evidence.

## Coverage and matching

- Source events: **285**
- Quotes retained: **1,710** (six per event)
- Exact canonical matches: **258**
- Deterministic team/week/kickoff alias matches: **19** (`LA` → `LAR`)
- Neutral-site exclusions: **8**
- Ambiguous, unmatched, or duplicate events in the accepted run: **0**
- Eligible non-neutral games: **277**

No unresolved event was attached to a Gridline game. Neutral-site games were
excluded because home/away spread orientation would otherwise be misleading.

## Core model and recorded-market accuracy

| Family | Model sample | Phase 6.1 holdout result | Recorded-market comparison |
|---|---:|---|---|
| Spread | 277 | MAE 10.2677; RMSE 13.2741 | 277 games; MAE 9.6606; RMSE 12.2377 |
| Moneyline | 277 | 62.45% accuracy; 0.633488 log loss; 0.222289 Brier | 277 games; 67.15% favorite accuracy; 0.597962 log loss; 0.206812 Brier |
| Totals | 230 | MAE 10.9452; RMSE 13.8741 | 230 games; MAE 10.1261; RMSE 13.0190 |

The recorded market was more accurate on the comparable game sets. This is a
recorded-line benchmark, not a verified closing-market benchmark.

### Retained Phase 6 reference comparison

The earlier Phase 6 references used all 285 games for spread/moneyline and 237
for totals. This market baseline excludes eight neutral-site games, so its
metrics are not claimed to reproduce those references.

| Family | Retained Phase 6 reference | Matched non-neutral baseline | Raw delta |
|---|---|---|---|
| Spread | N 285; MAE 10.1982; RMSE 13.2414 | N 277; MAE 10.2677; RMSE 13.2741 | MAE +0.0695; RMSE +0.0327 |
| Moneyline | N 285; accuracy 61.7544%; log loss 0.633853; Brier 0.222487 | N 277; accuracy 62.4549%; log loss 0.633488; Brier 0.222289 | Accuracy +0.70 pp; log loss -0.000365; Brier -0.000198 |
| Totals | N 237; MAE 10.8809; RMSE 13.8065 | N 230; MAE 10.9452; RMSE 13.8741 | MAE +0.0643; RMSE +0.0676 |

The deltas are descriptive because the eligible samples differ.

### Moneyline calibration

| Home-win probability | N | Average prediction | Actual home-win rate |
|---|---:|---:|---:|
| 0–10% | 0 | — | — |
| 10–20% | 3 | 17.40% | 0.00% |
| 20–30% | 23 | 25.97% | 17.39% |
| 30–40% | 43 | 35.98% | 46.51% |
| 40–50% | 62 | 45.11% | 40.32% |
| 50–60% | 59 | 54.62% | 50.85% |
| 60–70% | 59 | 64.61% | 59.32% |
| 70–80% | 22 | 74.92% | 90.91% |
| 80–90% | 6 | 83.60% | 100.00% |
| 90–100% | 0 | — | — |

## Regular-season weekly results

ATS and O/U records select the model-preferred side only when its absolute edge
is at least one point. Smaller edges are explicit no-bets. W-L-P-NB and average
absolute edge are shown without hiding losing weeks. This one-point audit rule
is fixed for comparison; it is not a recommended betting threshold.

| Week | ML acc. | Margin MAE | ATS W-L-P-NB | Avg spread edge | Total MAE | O/U W-L-P-NB | Avg total edge |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 66.7% | 6.87 | 5-6-0-4 | 2.29 | — | — | — |
| 2 | 87.5% | 8.08 | 6-4-0-6 | 2.63 | — | — | — |
| 3 | 43.8% | 13.43 | 6-5-0-5 | 2.61 | — | — | — |
| 4 | 46.7% | 9.86 | 5-6-0-4 | 3.16 | 9.76 | 3-8-0-4 | 2.16 |
| 5 | 53.8% | 11.57 | 6-4-0-3 | 3.25 | 9.11 | 4-5-0-4 | 2.60 |
| 6 | 71.4% | 7.40 | 8-4-0-2 | 3.29 | 8.43 | 6-4-0-4 | 2.98 |
| 7 | 64.3% | 11.53 | 4-6-0-4 | 2.77 | 11.74 | 7-5-0-2 | 4.37 |
| 8 | 69.2% | 15.94 | 3-7-0-3 | 3.21 | 10.21 | 5-7-0-1 | 2.71 |
| 9 | 57.1% | 9.95 | 6-7-0-1 | 3.50 | 10.41 | 4-8-0-2 | 3.90 |
| 10 | 76.9% | 9.88 | 5-6-0-2 | 3.82 | 14.30 | 5-5-0-3 | 3.94 |
| 11 | 71.4% | 8.72 | 9-4-0-1 | 3.27 | 9.98 | 7-5-0-2 | 3.44 |
| 12 | 64.3% | 7.21 | 7-3-1-3 | 3.98 | 8.93 | 6-5-0-3 | 3.80 |
| 13 | 56.3% | 9.77 | 7-7-0-2 | 3.11 | 9.03 | 3-7-0-6 | 3.34 |
| 14 | 50.0% | 13.20 | 5-7-0-2 | 2.50 | 10.88 | 5-6-0-3 | 4.26 |
| 15 | 62.5% | 11.46 | 4-9-0-3 | 3.69 | 14.59 | 5-8-0-3 | 3.67 |
| 16 | 56.3% | 11.70 | 7-7-0-2 | 3.68 | 10.05 | 6-9-0-1 | 3.51 |
| 17 | 68.8% | 10.63 | 6-7-0-3 | 3.60 | 12.22 | 8-7-0-1 | 4.45 |
| 18 | 50.0% | 10.15 | 6-9-0-1 | 4.31 | 12.85 | 7-8-0-1 | 4.37 |

The JSON report retains postseason weeks 19–22.

## Regular-season cumulative market results

| Through week | ATS W-L-P-NB | Avg spread edge | O/U W-L-P-NB | Avg total edge |
|---:|---:|---:|---:|---:|
| 1 | 5-6-0-4 | 2.29 | — | — |
| 2 | 11-10-0-10 | 2.46 | — | — |
| 3 | 17-15-0-15 | 2.51 | — | — |
| 4 | 22-21-0-19 | 2.67 | 3-8-0-4 | 2.16 |
| 5 | 28-25-0-22 | 2.77 | 7-13-0-8 | 2.36 |
| 6 | 36-29-0-24 | 2.85 | 13-17-0-12 | 2.57 |
| 7 | 40-35-0-28 | 2.84 | 20-22-0-14 | 3.02 |
| 8 | 43-42-0-31 | 2.88 | 25-29-0-15 | 2.96 |
| 9 | 49-49-0-32 | 2.95 | 29-37-0-17 | 3.12 |
| 10 | 54-55-0-34 | 3.03 | 34-42-0-20 | 3.23 |
| 11 | 63-59-0-35 | 3.05 | 41-47-0-22 | 3.26 |
| 12 | 70-62-1-38 | 3.13 | 47-52-0-25 | 3.32 |
| 13 | 77-69-1-40 | 3.13 | 50-59-0-31 | 3.32 |
| 14 | 82-76-1-42 | 3.08 | 55-65-0-34 | 3.41 |
| 15 | 86-85-1-45 | 3.13 | 60-73-0-37 | 3.43 |
| 16 | 93-92-1-47 | 3.16 | 66-82-0-38 | 3.44 |
| 17 | 99-99-1-50 | 3.19 | 74-89-0-39 | 3.52 |
| 18 | 105-108-1-51 | 3.26 | 81-97-0-40 | 3.58 |

## Edge buckets and confidence intervals

| Family | Absolute edge | N | W-L | Win rate | Wilson 95% CI | Mean absolute model error |
|---|---|---:|---:|---:|---:|---:|
| Spread | <1 | 53 | No bet | — | — | 10.07 |
| Spread | 1–1.99 | 55 | 27-27 (1 push) | 50.00% | 37.11%–62.89% | 11.03 |
| Spread | 2–2.99 | 42 | 21-21 | 50.00% | 35.53%–64.47% | 9.05 |
| Spread | 3–4.99 | 65 | 29-36 | 44.62% | 33.17%–56.66% | 9.05 |
| Spread | 5+ | 62 | 35-27 | 56.45% | 44.09%–68.06% | 11.86 |
| Totals | <1 | 48 | No bet | — | — | 10.21 |
| Totals | 1–1.99 | 42 | 20-22 | 47.62% | 33.36%–62.28% | 11.06 |
| Totals | 2–2.99 | 20 | 8-12 | 40.00% | 21.88%–61.34% | 9.65 |
| Totals | 3–4.99 | 58 | 26-32 | 44.83% | 32.75%–57.55% | 9.22 |
| Totals | 5+ | 62 | 30-32 | 48.39% | 36.41%–60.55% | 13.47 |

Spread directions were 129 home, 95 away, and 53 no-bets. Totals directions
were 90 over, 92 under, and 48 no-bets. These samples are insufficient to
recommend a threshold: confidence intervals are wide, and no threshold was
pre-registered.

## Price-aware return and CLV gates

Retained prices support one-unit price-aware grading on matched, non-neutral
games; no `-110` assumption is used.

| Family | Graded selections | Units | ROI |
|---|---:|---:|---:|
| Spread | 224 | -9.0346 | -4.03% |
| Moneyline | 277 | -9.9162 | -3.58% |
| Totals | 182 | -21.3446 | -11.73% |

**True CLV: unavailable.** The source has no provenance-matched earlier and
closing timestamps. Model-versus-recorded-line differences are never labeled
CLV. A verified closing-market accuracy baseline is also unavailable.

## Reproducibility and suitability

The import retains the source and evaluation-input fingerprints, source
terminology, every quote, match outcome, model artifact checksum, training seasons, prediction and
feature cutoffs, projections, and final-score outcomes in append-only tables.
Database triggers reject updates and deletes. The run never writes production
prediction snapshots, promotion history, or live model state.

Automated checks cover recorded-only provenance, deterministic matching,
neutral/duplicate exclusion, spread and totals orientation, pushes/no-bets,
price settlement, fixed buckets and confidence intervals, pregame-v3
isolation, through-2024 training, 2025-only evaluation, and exclusion of
market, Sleeper, depth, injury, starter, and personnel inputs.

**Suitability:** This is a fixed and reusable same-game baseline for a later
personnel-aware challenger. It is suitable for model and recorded-market
comparison. The sample is insufficient for selecting a betting threshold. It
is not suitable for claims about verified closing performance or true CLV.