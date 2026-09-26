# Weekly player scoring-TD probability research

Model: gridline-player-td-classification-v2. Input SHA-256: ad537e3e3895b51e99af9c05e895f1e20f1c0d0b422c5fcb726d845b691a7cdf. This is an offline development research evaluation, **not approved for live forecasts**.

Outcome is at least one rushing or receiving TD for QB/RB/WR/TE. QB passing TDs do not count. This is a player scoring event, not a sportsbook line, implied odds or betting advice.
Train seasons 2021, 2022, 2023; calibration 2024-first-half (2438 rows); held-out late 2024 and 2025. A calibration fit is available.
The 2021–24 schedule is date-only and withholds same-day evidence. 2025 evaluation requires an explicit final game and UTC kickoff. Current mutable imports were captured in 2026. Original per-week release/publication timestamps are not archived; structural pregame features are not proof of historically available information.

Raw player rows 40110; matched 27099; unmatched 9; team-game rows 2834; joined zone-20 facts 0.
Prepared train 13478, calibration 2438, held-out 8139; duplicates excluded 0 player / 0 team / 0 red-zone; unlabeled 0; fewer than three prior appearances 3044.
Held-out red-zone covered appearances 0; unavailable 8139. Missing PBP/ffopportunity is unavailable, not zero. The red-zone ablation cannot establish a benefit when no training-season facts exist.

## Same-cohort evaluation (lower Brier/log loss is better; higher AUC is better)

| Method | N | Scored | Brier | Log loss | AUC |
|---|---:|---:|---:|---:|---:|
| Model | 8139 | 1610 | 0.1449 | 0.4542 | 0.7143 |
| Baseline: position | 8139 | 1610 | 0.1576 | 0.4939 | 0.5609 |
| Baseline: player | 8139 | 1610 | 0.1556 | 0.4866 | 0.6309 |
| Baseline: teamOpponent | 8139 | 1610 | 0.1676 | 0.5196 | 0.5134 |
| Ablation: withoutUsage | 8139 | 1610 | 0.1490 | 0.4672 | 0.6797 |
| Ablation: withoutRedZone | 8139 | 1610 | 0.1449 | 0.4542 | 0.7143 |
| Ablation: withoutDefense | 8139 | 1610 | 0.1445 | 0.4530 | 0.7183 |
| Ablation: withoutScoringContext | 8139 | 1610 | 0.1454 | 0.4559 | 0.7151 |

**Research verdict:** On this reconstructed held-out cohort the model's Brier 0.1449 is below the player-rate baseline 0.1556. But removing the defensive family yields Brier 0.1445, so these defensive features have not demonstrated incremental scoring-TD value. The red-zone family was excluded for lack of verified training coverage; the without-red-zone row is intentionally identical. These measurements do not establish genuinely archived point-in-time availability, future accuracy, or approval to publish.

## Observed calibration by predicted probability decile

| Decile | N | Mean predicted | Observed scored |
|---|---:|---:|---:|
| 0 | 2046 | 0.0829 | 0.0670 |
| 1 | 3487 | 0.1402 | 0.1609 |
| 2 | 1202 | 0.2433 | 0.2870 |
| 3 | 657 | 0.3442 | 0.3562 |
| 4 | 363 | 0.4462 | 0.3747 |
| 5 | 214 | 0.5450 | 0.5000 |
| 6 | 127 | 0.6439 | 0.4882 |
| 7 | 40 | 0.7383 | 0.7000 |
| 8 | 3 | 0.8074 | 0.0000 |

## Coverage by position

| Position | Evaluated appearances | Scored | Mean predicted |
|---|---:|---:|---:|
| QB | 940 | 134 | 0.1256 |
| RB | 2099 | 532 | 0.2670 |
| WR | 3368 | 648 | 0.1900 |
| TE | 1732 | 296 | 0.1448 |

## Week coverage and observed scoring-rate uncertainty

Wilson intervals are descriptive, not confidence bounds on future model accuracy.

| Season/week | Evaluated appearances | Observed rate | Approx. 95% interval |
|---|---:|---:|---:|
| 2024 week 10 | 256 | 0.1914 | 0.1479–0.2440 |
| 2024 week 11 | 269 | 0.2193 | 0.1740–0.2725 |
| 2024 week 12 | 246 | 0.2195 | 0.1723–0.2753 |
| 2024 week 13 | 294 | 0.2313 | 0.1867–0.2828 |
| 2024 week 14 | 237 | 0.2278 | 0.1790–0.2853 |
| 2024 week 15 | 304 | 0.2007 | 0.1595–0.2493 |
| 2024 week 16 | 296 | 0.2500 | 0.2041–0.3023 |
| 2024 week 17 | 305 | 0.2197 | 0.1769–0.2695 |
| 2024 week 18 | 289 | 0.2249 | 0.1806–0.2765 |
| 2025 week 1 | 288 | 0.1875 | 0.1466–0.2366 |
| 2025 week 2 | 279 | 0.2437 | 0.1971–0.2974 |
| 2025 week 3 | 286 | 0.1853 | 0.1446–0.2344 |
| 2025 week 4 | 332 | 0.2018 | 0.1622–0.2483 |
| 2025 week 5 | 297 | 0.2121 | 0.1695–0.2621 |
| 2025 week 6 | 309 | 0.1909 | 0.1510–0.2385 |
| 2025 week 7 | 323 | 0.1641 | 0.1277–0.2084 |
| 2025 week 8 | 275 | 0.2109 | 0.1668–0.2629 |
| 2025 week 9 | 301 | 0.1960 | 0.1551–0.2446 |
| 2025 week 10 | 304 | 0.2039 | 0.1625–0.2528 |
| 2025 week 11 | 320 | 0.1625 | 0.1261–0.2069 |
| 2025 week 12 | 303 | 0.1551 | 0.1187–0.2002 |
| 2025 week 13 | 343 | 0.1953 | 0.1568–0.2406 |
| 2025 week 14 | 318 | 0.1855 | 0.1467–0.2319 |
| 2025 week 15 | 335 | 0.1851 | 0.1471–0.2302 |
| 2025 week 16 | 351 | 0.1994 | 0.1610–0.2444 |
| 2025 week 17 | 343 | 0.1720 | 0.1358–0.2155 |
| 2025 week 18 | 336 | 0.1399 | 0.1068–0.1811 |

WR1 is ranked by strictly prior team WR targets at each earlier cutoff; opponent WR1/other-WR rates are team-defense proxies, not named CB coverage. No individual WR–CB assignment is available.
Expected-TD ffopportunity is excluded: no licensed, uniquely matched, timestamped historical weekly releases were preserved. No invented red-zone zeros or postgame xTD inputs are used.
Live publication remains blocked by complete independently timestamped roster/team, injury/availability, depth/participation and source-publication evidence, plus a qualified calibration verdict and operational approval. Existing yardage simulations and Phase 6 models are unchanged.
