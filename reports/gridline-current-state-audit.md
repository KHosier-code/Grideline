# Gridline — Current-State Audit

**Audit date:** 2026-09-17  
**Scope:** repository, development database, production database metadata, retained evaluation reports, and the existing public deployment.  
**Mode:** read-only. No model fitting, promotion, prediction rewrite, sportsbook-history rewrite, authentication change, deployment change, or production-data mutation was performed.

## Evidence and interpretation rules

This audit uses current source and live database evidence. Task summaries are not treated as evidence. Development counts and production counts are reported separately where they differ. A row with a score value is not treated as a completed result unless game status is final/completed: scheduled 2026 rows currently carry 0–0 score fields. “Recorded market” means the retained nflverse games.csv line evidence; it is not a verified sportsbook close. “Projected,” “inferred,” and “historical” are kept distinct from published current depth or direct coverage evidence.

# 1. Executive summary

## Product stage and classifications

| Area | Classification | Direct assessment |
|---|---|---|
| Engineering/infrastructure | Production-ready | Express/React/Drizzle/PostgreSQL, append-only evidence, artifact integrity, admin authorization, durable worker, and health surfaces exist. Production startup and health check passed after a brief initial 500 during startup. |
| Data foundation | Functional but incomplete | Team history, PBP-derived team features, snaps, injuries, weather, and current market ingestion exist. Current market capture and depth completeness are not sufficient for premium claims. |
| Core model | Functional but incomplete | Phase 6.1 spread, moneyline, and totals artifacts are promoted and checksum-guarded, but retained 2025 evidence does not show market beating or profitability. |
| Personnel/depth | Experimental | Sleeper mapping and current-personnel interpretation exist, but exact OL slots, safety identity coverage, and several CB identities remain unresolved. |
| Player analytics | Functional but incomplete | QB/RB/WR/TE usage and snap evidence is real; projection, matchup, injury adjustment, player-v-player, TD, and prop layers are mostly unavailable. Defensive box-score rows are not a defensive analytics product. |
| Market analytics | Functional but incomplete | DK/FD spread, moneyline, and totals capture, best-book selection, implied probability, stale status, and movement serialization exist. The current 180-row corpus is stale and too short for CLV or movement research. |
| Confidence | Functional but incomplete | confidence-v1 is implemented and fail-closed; current validation produced 48 Week 2 market results, all Low. Historical tier validation is not evidence of profitability. |
| Consumer product | Functional but incomplete | Games and Game Detail are publicly inspectable and visually coherent. Several signed-in pages are real but sparse or placeholder; UI language can sound more authoritative than the evidence. |
| External review | Production-ready with limits | Existing public VM deployment is available at https://gridelineanalytics.com. It is not a new consumer-only deployment. Games and Game Detail are anonymous read-only; signed-in pages require authentication; Admin remains protected. |

## Biggest strengths

1. The system preserves source cutoffs, model versions, vectors, artifact checksums, prediction snapshots, market provenance, and append-only audit records.
2. The feature engine is explicit about chronology and unsupported metrics rather than silently imputing them.
3. The model comparison reports are unusually conservative: recorded lines are not called closes, CLV is not inferred, and personnel challenger gains are not overstated.
4. Week 1 2026 all-position participation evidence is broad: 1,492 snap rows across 16 games, including offensive and defensive positions.
5. Current API authorization separates public consumer reads from protected admin and mutation operations.

## Biggest weaknesses

1. Production market evidence is stale: 180 rows cover only 15 games and captures from 2026-09-14; the live board screenshot shows STALE, 1/16 games compared, DK on one game, FD on zero.
2. Current depth is not clean weekly starter truth: depth_chart_snapshots is empty, historical depth is week=0 style evidence, latest Sleeper mapping is 7,315/12,227 mapped (59.86%), 1,373 ambiguous, 3,539 unmatched, one collision.
3. The active model vector is a compact team-form baseline, not a player-aware or market-aware model: 24 form features plus three low-sample/QB-context fields.
4. The retained model evidence supports a useful baseline comparison, not a market-beating or profitable-betting claim. The recorded market beats the model on all three comparable families.
5. The consumer surface presents confidence, edges, matchup advantages, and “live/production” language that can outrun the underlying freshness and sample evidence.

## Top five priorities

1. Restore and monitor fresh market capture with explicit first/current/final-pre-kickoff semantics and source health gates.
2. Fix current-game result semantics so status, completion, and score fields cannot be conflated.
3. Make depth readiness honest and operational: freshness/contradiction states, current-team identity crosswalks, exact OL evidence, and surfaced unresolved counts.
4. Retain prediction-level walk-forward evidence and run a pre-registered personnel/injury challenger without promoting it automatically.
5. Expand real player analytics only after source contracts are clear: routes, target share denominators, injuries/depth effects, and player-level evaluation.

# 2. Current architecture

## Components

- **Frontend:** React/Vite TypeScript app in artifacts/nfl-analytics; Wouter routes, TanStack Query, Clerk provider, generated API client, responsive consumer and protected admin shells.
- **API:** Express 5 in artifacts/api-server. It mounts public health/NFL/consumer reads and protected dashboard, data-health, feature, model, prediction, sync, settings, confidence, and Usage Lab admin routes. Zod/OpenAPI contracts and generated clients are used.
- **Worker:** durable Node worker starts recurring scheduler, feed scheduler, and Usage Lab retention maintenance. The deployment target is a VM because the feed worker requires an always-on process.
- **Database:** PostgreSQL through Drizzle. Core entities, immutable snapshots, append-only sportsbook observations, prediction snapshots, model training/evaluation/promotion records, confidence results, scheduler state, identity evidence, and nflverse imports are represented in lib/db/src/schema/nfl.ts.
- **Authentication/authorization:** Clerk at the frontend/API boundary. Consumer game reads are anonymous; AdminOnly gates the admin UI; admin APIs use requireAdmin. Secret values remain server-side. The public admin-status endpoint exposes status metadata only, not admin functionality.
- **Scheduling:** persisted scheduler_jobs with leases, ET/DST-aware slots, advisory-lock feed scheduler, retry/failure state, kickoff freeze/grading jobs, and retention maintenance. The worker logged a calendar-unavailable fallback on this audit date while weather/injury attempts began.
- **Modeling:** pregame-v3 feature engine; Phase 6.1 linear regression spread, logistic regression moneyline, and gradient boosting totals. Artifacts are persisted with vector schema, metadata, checksum, training seasons, and sample policy.
- **Evaluation:** append-only evaluation predictions and retained aggregate reports. The 2025 market baseline is evaluation-only and uses nflverse games.csv recorded lines; the personnel comparison is evaluation-only and strictly pre-kickoff.
- **Market ingestion:** The Odds API adapter captures only DraftKings/FanDuel spread, moneyline, and total rows, normalizes events/team aliases, rejects ambiguity/post-kickoff input, and persists request/event audit information.
- **Personnel/depth ingestion:** ESPN schedule/injuries/best-effort depth; Sleeper current player/depth snapshots and identity mapping; nflverse historical depth/participation/snaps/identity. SportsDataIO is evaluation-only.
- **Consumer APIs:** /api/consumer/dashboard, /games, /games/:gameId, /performance, /trends, /props, /player-usage-games, and /player-usage. Reads are designed to return honest unavailable/partial/stale states.
- **Admin APIs:** dashboard/data-health, models, predictions, data-sync, settings, features/personnel audits, confidence audit/calculation, odds audit/capture, Usage Lab analytics, and evaluation reports. Mutating routes are protected.

## Data flow

external source → validated adapter/chronology cutoff → append-only normalized or snapshot persistence → pregame feature generation → artifact-validated model inference → prediction snapshot with source/model evidence → consumer API serialization → UI → kickoff freeze/grading/evaluation.

## Present-but-not-used or only partially downstream

- Historical depth and current Sleeper identity evidence are available but cannot supply exact OL slots and do not reach a promoted Phase 6.1 numerical feature vector.
- Injuries are fresh in the database, but the personnel comparison records 0/554 injury-unit availability and no injury-impact weighting in the challenger contract.
- Snap and usage data are available for offensive players and every-position Week 1 evidence, but the model is not player-aware and routes/air yards/red-zone usage are not persisted.
- Weather is persisted and serialized for supported venues, but not part of the active Phase 6 vector.
- Current market rows are present but stale relative to the review date and therefore fail confidence gates.

# 3. Source inventory

| Source | Endpoint/dataset and data | Cadence/current status | Historical/current and point-in-time behavior | Freshness/reliability | Licensing/production/downstream |
|---|---|---|---|---|---|
| ESPN | Schedule, scores, injuries, best-effort structured depth | Scheduled feed; injury rows current around 2026-09-17 01:54 UTC in dev | Current snapshots; schedule persisted; injury/depth timestamps retained | Schedule and injuries operational; depth rows are not guaranteed | ESPN terms/robots reuse is not verified for production. Feeds schedule, injuries, consumer context, admin health. |
| nflverse | Historical schedules, PBP/team stats, player stats, participation/snaps, historical depth, player identity/crosswalk | Historical import/repair feed | Historical 2021–2025 corpus and 2026 Week 1 snaps; source cutoffs used for features | Strong for retained historical datasets; aliases such as LA/LAR require canonicalization | Uses nflverse license; feeds features, models, usage, personnel fallback, reports. |
| Sleeper | Current player/depth snapshots and provider identities | Scheduled current snapshot; latest source captured 2026-09-17 01:56:56 UTC | Point-in-time snapshot and mapping evidence | Mapping is usable but incomplete: 7,315 mapped, 1,373 ambiguous, 3,539 unmatched, one collision out of 12,227 | Current personnel/consumer context; mapping data is not official starter truth. |
| The Odds API | DK/FD spread, moneyline, total quotes | Scheduled/manual capture; current retained rows last captured 2026-09-14 02:29 UTC | Timestamped append-only quote observations; pre/post-kickoff filtering | Current corpus stale and incomplete; errors scrubbed; quota/provider state tracked | Provider/API licensing and quota apply; feeds market board, line movement, confidence gates. |
| NWS | api.weather.gov forecast snapshots with venue, valid/fetched time, wind, precipitation, roof | Scheduled weather feed | Immutable, cutoff-safe forecasts; indoor/international unsupported states explicit | Dev 64 / production 208 snapshots; eligibility and timestamp alignment are modeled | Keyless API with descriptive User-Agent; feeds context/health, not Phase 6 vector. |
| Imported nflverse games.csv | 2025 source-designated recorded spread/total/moneyline values | Evaluation-only import | 285 events; no sportsbook/timestamp identity; not closing evidence | Deterministic qualification and matching; 258 exact, 19 LA→LAR alias, 8 neutral excluded | Upstream data terms apply; feeds evaluation reports only, never production market claims. |
| SportsDataIO | Evaluation-only depth comparison | Not production-ingested | Evaluation sample only | Not adopted; does not solve required current chronology/licensing/product fit | Deliberately disconnected from production depth interpretation. |
| Ourlads/NFL/team HTML | No ingestion | Not active | None | Ourlads prohibited by terms; official HTML not systematically retrieved absent consent | Not a production source. |

Data classes: current-state = ESPN/Sleeper/Odds/NWS snapshots and current prediction rows; historical = nflverse stats/depth and retained 2025 evaluation; inferred = projected starters/recent snap role and fallback depth; published = consumer/admin API values; model-derived = feature vectors, projections, confidence, challenger metrics.

# 4. Data coverage audit

## Team data

| Capability | Current evidence | Classification |
|---|---|---|
| Schedule | 70 game rows in dev/prod: 2026 Weeks 1–4, 16 games per week; Week 1 final, Weeks 2–4 scheduled | Functional but incomplete/current slate |
| Results | Week 1 has 16 final games; future scheduled rows carry 0–0 fields but must be gated by status | Functional but incomplete; score nullability risk |
| Team-game stats | 2,880 rows; 285 games each in 2021/2023/2024/2025, 284 in 2022, 16 in 2026 | Implemented historical/current |
| EPA | Stored in team-game rows and used by pregame-v3 | Implemented, team-level |
| Success rate | Stored and used for selected last-3/5/8 features | Implemented, team-level |
| Explosive plays | Stored as pass/rush explosive rates and used in vector | Implemented, team-level |
| Red zone | Stored as red-zone touchdown rate and used in vector | Implemented, team-level |
| Turnovers | Stored/derived turnover rate and used in feature definition; not all rows are guaranteed complete | Partial |
| Sacks | Sack-rate fields exist; pressure attribution is explicitly unsupported | Partial |
| Pass/rush splits | Pass/rush EPA and success metrics exist | Implemented, team-level |

## Player data by group

The database has 22,579 player-game stat rows, 134,108 snap rows, and 994 player records in dev. QB/RB/WR/TE dominate player-game stats; defensive rows exist but offensive box-score columns are not meaningful defensive analytics. 2026 snap evidence currently covers Week 1 only: 1,492 rows/16 games.

| Group | Historical usage/snaps | Targets/receptions/yards/carries/rush yards/TD | Routes/air yards/red-zone/alignment | Injury | Depth/starter/role confidence |
|---|---|---|---|---|---|
| QB | Implemented; qb_game_stats 3,566 rows | Passing/rushing box score implemented | Unavailable | Partial current injury feed | Partial inferred/published context |
| RB | Implemented; player stats and snaps | Implemented | Routes/red-zone share unavailable | Partial | Partial |
| WR | Implemented; player stats and snaps | Implemented | Routes, air yards, aDOT, alignment unavailable | Partial | Partial |
| TE | Implemented; player stats and snaps | Implemented | Routes, air yards, alignment unavailable | Partial | Partial |
| OL | Snaps/participation evidence available; player box score not a meaningful OL performance layer | Not applicable as receiver/rusher | OL slot/alignment unavailable | Partial | Exact LT/LG/C/RG/RT starters 0/160 in authoritative audit |
| DL/EDGE | Snaps and broad role/depth evidence available | Defensive box-score analytics not complete | Pass-rush pressure/matchup unavailable | Partial | EDGE starters 57/64; inferred role only |
| LB | Snaps and broad role evidence available | Defensive player analytics incomplete | Coverage/pressure context unavailable | Current injury rows | LB starters 63/64 |
| CB | Snaps and historical participation available | Defensive box-score columns not a coverage product | Direct coverage, alignment, man/zone unavailable | Current injury rows | CB1 26/32, CB2 28/32, CB3/slot 29/32 |
| S | Snaps and broad role evidence available | Defensive box-score columns not coverage product | Assignment/alignment unavailable | Partial | Starting identities 31/64; safety group recognized on 32/32 teams |

## Market data

| Capability | Evidence/status |
|---|---|
| Spread/moneyline/total | 180 rows total, 15 games, DK and FD x three markets |
| DK/FD | Both present in database, but production screenshot shows DK one game and FD zero for selected Week 1 board |
| First/current/final pre-kickoff | Serialization and cutoff logic exist; current corpus is too sparse/stale to demonstrate reliable streams |
| Historical 2025 recorded lines | 1,710 quotes across 285 nflverse events in evaluation-only report; source-designated recorded, not sportsbook/closing |
| Verified closing lines | Not available |
| Player props | Not implemented; /consumer/props returns unavailable/Soon |

## Weather

Production has 208 snapshots and dev 64. The code stores fetched/forecast/valid timestamps and indoor/outdoor/roof state, and excludes unsupported venues. A single complete eligible-game percentage cannot be claimed from the supplied aggregate counts; kickoff alignment is represented in code but was not recomputed as a complete audit table.

## Personnel readiness

| Role | Coverage |
|---|---:|
| QB1 | 32/32 (100.00%) |
| RB1 | 32/32 (100.00%) |
| WR1 | 32/32 (100.00%) |
| WR2 | 32/32 (100.00%) |
| WR3 | 31/32 (96.88%) |
| TE1 | 32/32 (100.00%) |
| CB1 | 26/32 (81.25%) |
| CB2 | 28/32 (87.50%) |
| CB3/slot | 29/32 (90.63%) |
| EDGE starters | 57/64 (89.06%) |
| LB starters | 63/64 (98.44%) |
| Starting safeties | 31/64 (48.44%) |
| Exact OL starters | 0/160 (0.00%) |
| Authoritative current depth rows | 1,317/1,472 (89.47%) |
| Authoritative order-1 rows | 487/543 (89.69%) |

# 5. Current model inventory

All three active production families use feature version pregame-v3 and train through 2025. Promotions were explicit administrator reviews; nine promotion-history rows exist in production, including current Phase 6.1 entries and historical promotions.

| Family | Algorithm/current version | Features | Training/sample policy | Holdout/evaluation | Status/limitations |
|---|---|---:|---|---|---|
| Spread | Linear regression; phase6-1-spread-01c85917b47c6e70c258fe02 | 27 ordered vector fields | 2021–2025 refit; include low sample; refit sample is retained in DB | Legitimate 2025 OOS through-2024: N=285, MAE 10.1982, RMSE 13.2414 | Promoted and artifact-validated; not market-beating evidence |
| Moneyline | Logistic regression; phase6-1-moneyline-917fa6e7417cccb45909ade4 | 27 | 2021–2025 refit; include low sample | N=285, accuracy 61.7544%, log loss 0.633853, Brier 0.222487 | Promoted; partial calibration evidence and no betting profitability |
| Totals | Gradient boosting; phase6-1-totals-749279b5856f1be1165c211d | 27 | 2021–2025 refit; exclude low sample | N=237, MAE 10.8809, RMSE 13.8065 | Promoted; low-sample exclusion and no closing-market proof |

Exact model artifact status: fitted artifacts, vector names, schema fingerprint, metadata, and checksum are persisted and validated before inference. The 2025 aggregate audit notes that individual Phase 4 candidate predictions were not retained for the older OOS run; do not reconstruct them without an explicit evaluation run.

Challengers: Phase 4 algorithm candidates exist as evaluation/training runs. The personnel-aware challenger comparison is retained separately and is not promoted. No challenger materially improved any family.

# 6. Exact active feature set

The active Phase 6 vector has 27 fields: 24 source team-form fields plus three context fields. It is not the entire supported feature definition; many supported metrics are present in feature generation but are not selected into the production vector.

| Active feature group | Exact fields | Source/window | Player/injury/depth/market/personnel aware? |
|---|---|---|---|
| last_3 | defensive_success_rate, epa_per_play, explosive_pass_rate, explosive_rush_rate, offensive_success_rate, red_zone_touchdown_rate, turnover_rate, yards_per_play | nflverse PBP/team-game stats; last 3 prior games; cutoff-safe | No |
| last_5 | same eight metrics | nflverse PBP/team-game stats; last 5 prior games | No |
| last_8 | same eight metrics | nflverse PBP/team-game stats; last 8 prior games | No |
| context | home_low_sample, away_low_sample | feature sample policy | No; quality gate only |
| context | qb_confidence_difference | prior primary QB participation / QB history | QB context only; not injury/depth/market |

Feature generation supports season_to_date and additional metrics including opponent-adjusted EPA, pass/rush EPA, success rates, sack rate, early-down metrics, pace proxy, explosive rates, third down, red zone, and neutral-script pass rate. The active production vector selects only the 24 listed form fields plus three context fields. Unsupported in source definition: points per drive, pressure rate allowed, defensive pressure rate.

**Feature composition:** team form 24/27 fields; QB context 1/27; quality gates 2/27; personnel 0/27; injuries 0/27; direct matchup 0/27; market 0/27; weather 0/27; player-level 0/27. Personnel/injury/weather code exists in context/challenger paths but is not part of the active Phase 6 vector.

# 7. Model quality audit

## Legitimate 2025 OOS and recorded-market comparison

| Family | Model | Recorded market | Conclusion |
|---|---|---|---|
| Spread | N=277 matched non-neutral; MAE 10.2677, RMSE 13.2741 | N=277; MAE 9.6606, RMSE 12.2377 | Recorded market better |
| Moneyline | N=277; accuracy 62.45%, log loss 0.633488, Brier 0.222289 | Favorite accuracy 67.15%, log loss 0.597962, Brier 0.206812 | Recorded market better |
| Totals | N=230; MAE 10.9452, RMSE 13.8741 | N=230; MAE 10.1261, RMSE 13.0190 | Recorded market better |

The retained broader through-2024 OOS report gives spread N=285 MAE 10.1982/RMSE 13.2414, moneyline N=285 accuracy 61.7544%/log loss 0.633853/Brier 0.222487, totals N=237 MAE 10.8809/RMSE 13.8065. Those are aggregate holdout metrics, not prediction-level betting records.

## ATS, totals, ROI, CLV

The market baseline uses a fixed one-point edge audit rule, not a recommended threshold. Regular-season cumulative through Week 18: ATS 105-108-1 with 51 no-bets; O/U 81-97-0 with 40 no-bets. Graded price-aware returns: spread 224 selections, -9.0346 units, -4.03% ROI; moneyline 277, -9.9162 units, -3.58%; totals 182, -21.3446 units, -11.73%. True CLV is unavailable because source observations do not carry provenance-matched opening and closing timestamps. No verified close exists.

Edge buckets are wide and insufficient for a betting threshold. Spread 5+ points was 35-27 (56.45%, Wilson 44.09–68.06%); totals 5+ was 30-32 (48.39%, Wilson 36.41–60.55%).

## Claims supported

- **Market-beating claim:** No. The comparable recorded market outperformed the model in all three families.
- **Profitable betting claim:** No. Retained price-aware returns are negative and not verified closing performance.
- **Strong calibration claim:** No. Moneyline calibration is partial and bucket uncertainty is substantial; confidence tiers fail closed.
- **Useful baseline-model claim:** Yes, narrowly. It is a reproducible team-form baseline for future controlled challengers, not a premium betting edge.

# 8. Personnel-aware challenger status

Code exists in the personnel context/coverage and challenger evaluation paths. A numerical comparison report now exists at reports/gridline-2025-personnel-comparison.md and JSON. It is strictly pre-kickoff, trains 2021–2024, tests 2025, pairs exact games, and does not mutate production.

| Family | Baseline → challenger | Raw result | Verdict |
|---|---|---|---|
| Spread | MAE 10.2677 → 10.2627 | 0.05% improvement | No material improvement |
| Moneyline | log loss 0.6335 → 0.6345 | -0.16% | No material improvement |
| Totals | MAE 10.9452 → 10.9452 | 0.00% | No material improvement |

Included/reconstructed legitimately: QB starter likelihood, depth/snap inference, current personnel context where cutoff-safe, and explicit coverage/availability gates. Historical injury-unit availability, OL replacement quality, direct CB assignments, roster trades, and exact historical official depth are unavailable; the report records these as zero rather than imputed. Current challenger performance is known for this evaluation only and does not justify promotion.

# 9. Player analytics status

| Group | Historical usage | Rolling usage | Projection | Matchup score | Injury/depth adjustment | Opponent adjustment | Player-v-player | TD probability | Prop comparison |
|---|---|---|---|---|---|---|---|---|---|
| QB | Implemented | Partial/implemented for prior games | Unavailable as player stat model | Unavailable | Partial context only | Unavailable | Unavailable | Unavailable | Unavailable |
| RB | Implemented | Implemented via Usage Lab windows | Unavailable | Unavailable | Partial context only | Unavailable | Unavailable | Unavailable | Unavailable |
| WR | Implemented | Implemented via Usage Lab windows | Unavailable | Partial context only | Partial display context | Unavailable | Unavailable | Unavailable | Unavailable |
| TE | Implemented | Implemented via Usage Lab windows | Unavailable | Unavailable | Partial context only | Unavailable | Unavailable | Unavailable | Unavailable |
| CB | Snaps/participation implemented | Partial | Unavailable | Partial unit evidence only | Partial injury/depth context | Unavailable | Unavailable | Unavailable | Unavailable |
| EDGE/LB | Snaps/role evidence implemented | Partial | Unavailable | Unavailable | Partial | Unavailable | Unavailable | Unavailable | Unavailable |
| OL | Snaps/participation available | Partial | Unavailable | Unavailable | Partial broad OL context | Unavailable | Unavailable | Unavailable | Unavailable |

Usage Lab supports snap share, targets, target share where denominator exists, receptions, receiving/rushing yards, carries, TD totals, yards per target/carry. It explicitly marks red-zone touches/targets and explosive rate unsupported. “Implemented” here means evidence aggregation, not a player projection model.

# 10. WR-CB matchup readiness

| Role/evidence | Readiness |
|---|---|
| WR1/WR2/WR3 identity | WR1 and WR2 32/32; WR3 31/32 depth evidence. Snap/usage history is available. |
| CB1/CB2/CB3-slot identity | CB1 26/32, CB2 28/32, CB3/slot 29/32. Generic DB role normalization improved interpretation, not identity coverage. |
| Mapping coverage | Latest Sleeper run: 59.86% mapped overall; 11.24% ambiguous; 28.96% unmatched; one collision. |
| Starter confidence | Partial; published/projected/uncertain roles are labeled. Current depth logic not ready. |
| Snap availability | Strong historical snap availability; 2026 current snaps are Week 1 only. |
| Historical performance | Offensive usage available; no direct WR-v-CB performance record. |
| Direct coverage data | Unavailable. |
| Alignment data | Unavailable. |
| Zone/man assignments | Unavailable. |
| Injury context | Current injury rows exist, but historical injury replacement impact is not quantified. |
| Projection capability | No supported player-v-player projection. Matchup board can show supported unit/context evidence only and does not alter predictions. |

Gridline can legitimately say that persisted WR/CB identities, broad role/depth evidence, recent snaps, current injury designations, and unit-level context are available for some teams. It cannot legitimately claim that a named CB covered a named WR, that a matchup is man/zone, that an alignment is known, or that a WR-v-CB edge changed the model projection.

# 11. Injury analytics

ESPN injury ingestion is current around 2026-09-17 01:54 UTC in development and covers 32 teams for QB/RB/WR/TE/LB, with incomplete team/position breadth elsewhere. Sleeper is supplemental identity/depth evidence, not a complete historical injury feed. Production has 1,644 injury rows; development has 1,527.

Injury designations are available to current context and readiness displays. Phase 6.1 numerical features do not use injury rows. The personnel challenger has an injury field but retained evidence reports 0/554 injury-unit observations and no replacement-quality or positional injury weights. Therefore Gridline currently knows some injuries but usually fails to quantify their effect on predictions. No positional injury-importance model exists.

# 12. Depth-chart status

- **Sleeper ingestion:** active, timestamped snapshots and identity mapping.
- **Latest mapping:** 12,227 processed; 7,315 mapped (59.86%); 1,373 ambiguous (11.24%); 3,539 unmatched (28.96%); one collision; status success.
- **Current depth table:** depth_chart_snapshots has 0 rows in development. Historical depth has 553,770 2025 week=0 rows and 522,497 2026 week=0 rows across 32 teams; this is not clean weekly starter truth.
- **QB1/RB1/WR1/WR2/TE1:** 100% authoritative role coverage in the recovery report.
- **WR3:** 96.88%; CB1 81.25%; CB2 87.50%; safety starter identities 48.44%; exact OL slots 0%.
- **Current-depth readiness:** Not ready as a complete downstream personnel gate; current interpretation recognizes broad groups but all 32 teams remain not downstream-ready because OT/OG/C evidence is missing.
- **Consumer readiness:** Consumer context can display published/projected/uncertain depth and freshness, but it must not be read as an official full lineup.
- **Ambiguity:** unmatched current identities, conflicting team evidence, generic DB/S/OLB labels, and missing exact OL slot rows. Trent McDuffie’s current LA/LAR identity is a concrete example where stable nflverse participation corroborates the role but the Sleeper crosswalk remains unresolved.
- **SportsDataIO:** evaluation-only evidence was not adopted into production due to source/licensing/product-fit and chronology concerns; it does not replace a current, timestamped, slot-specific official source.

# 13. Market analytics

- **Market Board:** implemented consumer surface with model comparison, supported books/markets, evidence timestamp, stale/partial/absent status, and confidence cards.
- **Line Movement:** serializer supports first observed/current/final pre-kickoff and max observation truncation; the current retained corpus is too short for meaningful movement research.
- **Best-book logic:** implemented for supported canonical lines; exact ties prefer DraftKings; the UI/API distinguishes favorable points and American prices.
- **Implied probabilities:** implemented for valid American moneyline prices.
- **Stale logic:** 30-minute consumer stale threshold; current screenshot correctly shows STALE.
- **Historical baseline:** 2025 source-designated recorded lines exist only in evaluation report; no sportsbook/timestamp identity.
- **Closing lines/CLV:** unavailable. No true CLV claim is valid.
- **Current sufficiency:** not enough history to evaluate CLV, identify steam, compare edge at multiple reliable timestamps, or train a market-residual model. First/current/final fields exist structurally but are not populated with sufficient clean history.

# 14. Player prop readiness

| Prop | Player data | Historical sample | Projection | Sportsbook market | Missing/cost implication |
|---|---|---|---|---|---|
| Passing yards | Box score available | Historical QB rows available | Unavailable | No player props ingested | Need prop quotes, pass attempts/context; new provider/quota |
| Passing TDs | Box score available | Historical QB rows available | Unavailable | Unavailable | Need TD projection and prop history |
| Rushing yards | RB/player stats available | Historical sample available | Unavailable | Unavailable | Need role/attempt model and prop quotes |
| Receiving yards | WR/TE stats available | Historical sample available | Unavailable | Unavailable | Need routes/target quality/prop history |
| Receptions | Partial target/reception data | Historical sample available | Unavailable | Unavailable | Need route/target share and prop quotes |
| Anytime TD | TD outcomes available | Historical outcomes available | Unavailable | Unavailable | Need red-zone/goal-line/role features and binary prop history |

Do not implement props until player-role chronology, target/rush opportunity, book/line history, and evaluation baselines exist. The current /props screen is a placeholder/unavailable state.

# 15. UI/product maturity

| Surface | Classification | Evidence and limitation |
|---|---|---|
| Home | Partial; signed-in | Dashboard exists with schedule, freshness, model gate, edges; “Production model online”/“weekly read” can sound stronger than data freshness. |
| Games | Implemented but partial | Public, real schedule/market comparison; production screenshot shows stale 1/16 comparison and Low 0/100 confidence. |
| Game Detail | Implemented but partial | Public read-only real game detail, confidence, context, usage/matchup evidence; no direct coverage claims. |
| Performance | Implemented but incomplete | Consumer/admin performance surfaces exist; historical prediction grades are zero in dev and market evidence is limited. |
| Trends | Implemented but incomplete | Route and API exist; depth/player/market history limits interpretation. |
| Props | Placeholder/blocked | Route exists; API returns unavailable and nav labels Soon. |
| Market Board | Implemented but stale/partial | Embedded in Games rather than standalone consumer route; current live board visibly stale. |
| Line Movement | Partial/readiness | Admin route exists, but generic health/readiness presentation and sparse history limit usefulness. |
| Depth Chart | Partial/experimental | Consumer context is embedded, not standalone; exact OL and unresolved identity gaps remain. |
| Player Usage | Implemented but partial | Usage Lab and player usage APIs aggregate real historical rows; several metrics explicitly unavailable. |
| Matchup Board | Implemented but partial | Embedded in Game Detail; supported unit/context evidence only, no player-v-player coverage. |
| Confidence | Implemented but partial | Embedded market cards; no standalone consumer route; methodology/disclosures exist but score badges are prominent. |
| Admin | Implemented but incomplete | Protected shell and many audits/settings exist; backtesting/readiness and several health routes remain placeholders/generic. |

Visual review: the production Games page is polished and scan-friendly with strong hierarchy, but the premium presentation makes stale/absent market evidence and 0/100 confidence especially important to keep visible. The most important overstatement risks are “production model online,” “top edges,” “biggest matchup advantages,” “Trust status,” “verified/current,” and confidence tiers without adjacent freshness/sample/cutoff evidence.

# 16. Confidence system

Implemented confidence-v1 keeps Data Confidence, Model Confidence, and Market Edge Strength separate and combines them as 0.35 × data + 0.35 × model + 0.30 × market edge. Components are normalized 0–100. Data is the minimum of QB evidence and feature completeness; low-sample snapshots cap at 49 and missing features fail the gate. Model blends projection-revision stability (when at least two immutable snapshots exist) with retained family error context. Market Edge is 70% model/market difference, 10% freshness, 10% fresh two-book coverage, and 10% DK/FD agreement. Labels: Low <50, Moderate 50–69, Strong 70–84, Very Strong 85–100.

Strong/Very Strong are capped when snapshots/artifacts/personnel/starters/market freshness/two-book agreement are unresolved. Development validation on 16 Week 2 games produced 48 market results: Low 48, Moderate 0, Strong 0, Very Strong 0. Historical evaluation rows also fail closed to Low because per-game data confidence, verified artifact, starter resolution, revision, and timestamped sportsbook evidence are absent. This is implemented methodology, not proof of predictive quality or profitability. Historical tier validation is partial and descriptive.

# 17. Technical debt and integration risks

| Risk | Priority | Evidence |
|---|---|---|
| Scheduled rows carrying 0–0 final scores | Critical | Results must be gated by game_status; non-null scores are not completion evidence. |
| Stale/incomplete production market capture | Critical | 180 rows/15 games, all captured 2026-09-14; screenshot STALE, 1/16. |
| Current depth table empty and week=0 historical snapshots | High | No clean current weekly starter table; chronology/role interpretation caveats. |
| Identity mapping unresolved | High | 7,315/12,227 mapped; 1,373 ambiguous, 3,539 unmatched. |
| Exact OL slots absent | High | 0/160 authoritative exact starter slots. |
| Injuries known but not quantified | High | Current rows exist; Phase 6/challenger injury impact effectively zero/unavailable. |
| Missing prediction-level retention for older OOS | High | Aggregate metrics retained; individual 2025 candidate predictions not retained in older run. |
| Lack of verified closing-line provenance | High | No timestamps/book identity in nflverse recorded market; true CLV unavailable. |
| Generated client/API drift | Medium | OpenAPI/codegen is the source-of-truth workflow; task backlog identifies drift test need. No current failure is asserted from this audit. |
| Scheduler/feed fallback and overlap | Medium | Durable leases/advisory locks exist; worker logged calendar-unavailable baseline fallback. Always-on VM operational dependency remains. |
| DB growth/capacity | Medium | Append-only snapshots, market rows, depth history, analytics retention and capacity health exist; depth history is already >1.2M dev rows. |
| Missing player-level tests/evaluation | Medium | Usage tests exist, but no complete player projection/prop evaluation layer. |
| Provenance gaps | Medium | Historical recorded lines and inferred depth are labeled, but consumers need consistent labels at every surface. |
| Historical reconstruction weaknesses | High | Historical injuries, direct coverage, exact OL, roster transactions unavailable. |
| Unreproducible task artifacts | Low/Medium | Current repository retains major reports; any isolated artifacts not in repository are not treated as evidence. |
| Source licensing/terms | High | ESPN depth terms/robots not verified, Ourlads prohibited, official HTML not ingested. |
| Manual operational steps | Medium | Admin review required for promotions/settings/syncs; health and fallback states need active monitoring. |

No missing migration is asserted from the current schema/production smoke evidence. A database smoke check passed and build generated successfully; schema/codegen checks remain operational controls, not proof that all future drift is impossible.

# 18. Analytics gap analysis

| Capability | Classification |
|---|---|
| EPA splits | Already implemented at team-form level; not full player/drive split |
| Success-rate splits | Already implemented at team-form level |
| Early-down offense/defense | Partially implemented in feature definition; not active vector |
| Neutral-script pass rate | Partially implemented in feature definition; not active vector |
| Pressure/sack context | Partially implemented for sack rate; pressure rate unavailable |
| OL continuity | Partially implemented as proxy; exact slots/replacement quality unavailable |
| QB under pressure | Requires new source |
| Explosive-play creation/prevention | Partially implemented team rates |
| Red-zone efficiency | Partially implemented team rate; player red-zone share unavailable |
| Opponent-adjusted metrics | Partially implemented in feature generation; not selected into active vector |
| Strength of schedule | Requires new analytical layer |
| Play-action | Requires new play-level source/fields |
| Motion | Likely paid/tracking source or richer play-level source |
| Personnel grouping | Requires new or richer play-level source |
| Route participation | Requires new source; likely paid or specialized provider |
| Target share | Data available and used in Usage Lab for supported denominators; not model feature |
| Air yards | Requires new source |
| aDOT | Requires new source |
| Red-zone share | Requires new source/role layer |
| Coverage shell | Requires likely paid/tracking source |
| Man/zone | Requires likely paid/tracking source |
| CB alignment | Requires likely paid/tracking source |
| Pass-rush matchups | Requires likely paid/tracking source |
| Pace | Partially represented by seconds per play; not active vector |
| Game script | Requires richer play/game-state feature layer |
| Weather | Data available but unused in active vector |
| Injuries | Data available but unused in active Phase 6 numerical vector |
| Depth | Data available/inferred but not safe enough for full production vector |
| Roster changes | Requires immutable transaction/roster source |
| Player props | Not implemented; requires new market source |
| Historical market movement | Current serializer exists; sufficient clean history absent |
| Closing lines | Requires a timestamped, book-identified market source |

The premium-product gap is not more UI. It is player opportunity data, point-in-time personnel quality, verified market history, and evaluation retention.

# 19. Data-source gap recommendations

| Candidate | Solves | Cost/licensing | Essential? | Priority |
|---|---|---|---|---|
| Verified current depth chart | Exact starters and OL slots | Prefer official/licensed; terms must permit reuse | Near-essential for personnel claims | P0 |
| Historical injuries | Cutoff-safe replacement/availability backtest | Likely paid or licensed archive | Essential before injury challenger | P1 |
| Route participation/air yards | WR/TE opportunity model | Specialized/likely paid | Valuable, not foundational to core game model | P1 |
| Coverage assignments/shell | WR-CB claims | Likely paid tracking data; high licensing cost | Not essential until product commits to matchup analytics | P2 |
| CB/pass-rush performance | Player matchup quality | Likely paid | Not essential before identity/depth foundation | P2 |
| True historical closing odds | CLV, market residual, price-aware backtests | Paid/licensed or contractually permitted archive | Essential for betting research claims | P0 |
| Player props | Prop model/market comparisons | Odds API plan/provider cost; market retention | Not essential to core game model | P2 |
| Play-level tracking | Motion, shell, assignment, pressure | Likely expensive | Not justified until ROI test | P3 |

Do not add an expensive source until a target metric, walk-forward design, licensing approval, and promotion gate are defined.

# 20. Recommended model roadmap

| Phase | Features/sources | Backtest feasibility | Evaluation/promotion gate |
|---|---|---|---|
| Phase 6.1 baseline | Current pregame-v3 24 form + 3 context fields | Strong; retained history | Keep as baseline; no claim beyond reproducible baseline |
| Phase 7 personnel challenger | Current QB/depth/starter context with strict cutoffs | Partial; historical exact OL/injury evidence missing | Must beat baseline by pre-registered margin with paired intervals and no leakage |
| Phase 7.1 injury/depth | Timestamped injuries, position/role weights, exact current starters | Blocked until historical source improves | Coverage threshold, chronology tests, calibration and error improvement |
| Phase 7.2 player matchup | Routes/targets/CB assignments only if licensed source is acquired | Blocked for direct WR-CB today | Identity coverage, direct assignment coverage, player-level walk-forward improvement |
| Phase 8 market residual/ensemble | Verified multi-book history, timestamps, closing prices | Blocked by current market archive | No promotion without verified close, CLV, baseline comparison, and stability |

Complexity is not a promotion criterion. The baseline stays active until a challenger wins on pre-registered out-of-sample metrics, calibration, stability, and operational coverage.

# 21. Player-model roadmap

| Model | Target | Features | Evaluation |
|---|---|---|---|
| QB passing | Passing yards/attempts or EPA | Prior QB usage, opponent defense, pressure if sourced, weather, role/injury | Walk-forward by season; compare naive/team baselines and prop lines |
| RB rushing | Carries/rushing yards | Snap share, carry share, goal-line role, opponent rush defense, score script | Walk-forward; compare carry/yard baselines and prop lines |
| WR receiving | Targets/receiving yards | Routes, snap share, target share, aDOT/air yards, CB/coverage only if sourced | Walk-forward; player-season leakage audit; prop comparison |
| Receptions | Receptions | Routes, targets, target share, game environment, role | Walk-forward against empirical and sportsbook baselines |
| TD probability | Anytime/receiving/rushing TD | Red-zone opportunities, goal-line role, team scoring, opponent, injury/depth | Proper scoring rules, calibration, base-rate baseline, prop comparison |

No player model should be promoted until source completeness, cutoff chronology, minimum sample, calibration, and market comparison are retained per prediction.

# 22. Priority matrix

| Rank | Task | Priority | Analytical impact | Product impact | Effort | Cost | Risk |
|---:|---|---|---|---|---|---|---|
| 1 | Restore fresh DK/FD capture and alert stale board | P0 | High | High | Medium | Existing provider | Medium |
| 2 | Enforce game-status result semantics and regression tests | P0 | High | High | Small | None | Low |
| 3 | Add verified closing-line source/provenance | P0 | High | High | High | Paid/licensed likely | High |
| 4 | Add current depth freshness/contradiction health | P0 | High | High | Medium | Existing sources | Medium |
| 5 | Resolve identity crosswalk/team aliases | P1 | High | High | Medium | None/low | Medium |
| 6 | Acquire historical injury archive | P1 | High | Medium | High | Likely paid | High |
| 7 | Retain prediction-level evaluation evidence | P1 | High | Medium | Medium | DB growth | Medium |
| 8 | Add personnel challenger report to admin | P1 | Medium | High | Medium | None | Low |
| 9 | Add model feature usage audit showing active vs available | P1 | Medium | High | Small | None | Low |
| 10 | Add player usage denominators/partial reasons everywhere | P1 | Medium | High | Medium | None | Low |
| 11 | Add route participation/air yards if licensed | P2 | High | High | High | Likely paid | High |
| 12 | Add player receiving/rushing baseline models | P2 | High | High | High | None/new data | Medium |
| 13 | Add direct coverage data | P2 | High | High | Very high | Likely paid | High |
| 14 | Add prop ingestion and historical archive | P2 | Medium | High | High | Provider cost | High |
| 15 | Improve standalone market/movement views | P2 | Medium | Medium | Medium | None | Low |
| 16 | Add depth/player saved follows | P3 | Low | Medium | Medium | None | Low |
| 17 | Add external reviewer checklist/report tooling | P3 | Low | Medium | Small | None | Low |
| 18 | Add motion/personnel grouping | P3 | Medium | Medium | High | Tracking cost | High |
| 19 | Add cosmetic dashboard variants | P3 | Low | Low | Medium | None | Medium |
| 20 | Automated betting/action execution | P3 | Low | High risk | High | Legal/provider | Critical |

# 23. What not to build yet

- Do not add cosmetic dashboards or stronger badges before fresh markets, depth truth, and evidence labels are fixed.
- Do not publish unsupported direct WR-CB coverage, man/zone, shell, alignment, or player-v-player claims.
- Do not automate betting or present negative/partial evaluation as profitability.
- Do not promote the personnel challenger: it has no material improvement.
- Do not add paid tracking/props sources without a measurable ROI and licensing decision.
- Do not expand confidence tiers or select betting thresholds from current sparse/stale history.
- Do not treat week=0 historical depth or recent snaps as official exact starters.

# 24. 30/60/90-day roadmap

## Next 30 days

1. Fix/gate score semantics by status and add database/API tests.
2. Restore market capture cadence, stale alerts, DK/FD coverage dashboard, and source timestamp display.
3. Surface depth freshness, unresolved/ambiguous identities, and exact OL-unavailable states in admin and relevant consumer context.
4. Retain prediction-level evaluation rows for all new walk-forward runs.
5. Reconcile LA/LAR and other provider aliases across identity, schedule, market, and snap joins.

## Next 60 days

1. Produce a controlled injury/depth challenger only if cutoff-safe historical evidence meets a pre-registered coverage threshold.
2. Add current personnel comparison reporting to Admin and expose evidence/cutoff/coverage without implying official starters.
3. Expand Usage Lab denominators and partial-state explanations; measure interpreted starter vs actual participation.
4. Establish a licensed/verified market archive decision and implement close/CLV gates only if source terms and timestamps support it.

## Next 90 days

1. Either promote a demonstrably improved personnel/injury challenger or retain Phase 6.1 with an explicit no-promotion decision.
2. Add player-level opportunity baselines for QB/RB/WR/TE if route/role data is sufficient.
3. Build a real market-residual evaluation only from verified multi-book timestamp history.
4. Rework consumer language so confidence/edges/advantages are always adjacent to freshness, sample, source, cutoff, and “not a recommendation.”

# 25. External product review access

**Existing review URL:** https://gridelineanalytics.com  
**Deployment:** public VM; current build reported successful.  
**Authentication:** anonymous access is available for consumer Games and Game Detail routes/API. Home, Usage Lab, Performance, Trends, and Props are signed-in surfaces. Admin is protected by Clerk/AdminOnly and API requireAdmin.  
**Accessible real data:** Games/Game Detail use persisted schedule, scores only when status is final, prediction snapshots where valid, market evidence where present, confidence, weather/personnel context, and explicit sparse/stale states. The production Games screenshot captured 2026-09-17 shows real stale state: 1/16 games compared, DK one game, FD zero, Low 0/100.  
**Representative versus real:** no fabricated values were added. Empty, stale, low-confidence, and unavailable states are real.  
**Expiration/removal:** none; this is the existing public deployment, not a temporary review deployment. Remove access only through normal deployment visibility/domain controls.  
**Security confirmation:** no admin functionality was made public; no secrets, database tools, raw provider payloads, or public mutation access were added. Do not share authenticated credentials with reviewers.

# 26. Screenshot/review fallback

A safe public URL exists, so a screenshot fallback was not required. For reviewer orientation, reports/product-review/production-games.png is a real production capture of /games from 2026-09-17. It is desktop-width and shows the actual stale/partial state, not a fabricated populated state. The URL is the authoritative review path; screenshots are a static record only.

# 27. Product review checklist

## Visual quality

- [ ] Does Gridline look premium without making sparse evidence look complete?
- [ ] Is hierarchy clear on desktop and mobile?
- [ ] Is information too dense or too sparse?
- [ ] Do cards feel repetitive?
- [ ] Are numbers easy to scan?
- [ ] Does mobile navigation and layout feel intentional?

## Analytics clarity

- [ ] Is it obvious what Gridline actually knows versus infers?
- [ ] Are model projections distinct from sportsbook values?
- [ ] Are confidence labels and 0/100 states understandable?
- [ ] Are unavailable, stale, partial, and low-sample states honest?
- [ ] Does depth/personnel information add value without implying official starters?
- [ ] Does matchup analysis feel substantive without unsupported coverage claims?

## Trust

- [ ] Does any page overstate confidence, freshness, “production,” “verified,” or “best”?
- [ ] Does each projection explain why it exists and its source cutoff?
- [ ] Are source freshness and uncertainty visible enough?
- [ ] Does anything look more authoritative than the underlying data warrants?

## User value

- [ ] What would make a serious NFL bettor/researcher return daily?
- [ ] What is currently missing?
- [ ] Which page provides the most value?
- [ ] Which page provides the least value?
- [ ] What should be removed or simplified?

# 28. Final assessment

1. **Real analytics product or polished dashboard?** It is a real analytics product at the team-form, data-provenance, and operational-evidence layer, presented through a polished dashboard. It is not yet a complete premium player/matchup/market-research product.
2. **Data foundation strong enough?** Strong for team history and baseline modeling; not strong enough for verified closing-market, exact depth, direct coverage, or comprehensive injury claims.
3. **Model sophisticated enough?** Sophisticated enough as a reproducible baseline with integrity controls; not enough to claim market-beating performance or player/personnel superiority.
4. **Player layer strong enough?** No. Usage evidence exists, but player projections, routes, direct matchups, injury weights, depth adjustments, and props are missing or partial.
5. **Market layer strong enough?** No. The architecture is sound, but current market history is stale/sparse and verified closes/CLV are absent.
6. **Three biggest missing capabilities:** fresh verified market history with closes; point-in-time personnel/injury quality including exact OL and identity coverage; player opportunity/matchup data with retained prediction-level evaluation.
7. **Build next:** status-safe results and market freshness first, then depth/identity health and evaluation retention, then controlled injury/personnel/player challengers.
8. **Do not touch now:** automated betting, unsupported coverage claims, confidence inflation, cosmetic dashboard expansion, or paid tracking sources without a measured case.
9. **Most improve model quality:** add reliable cutoff-safe personnel/injury/opportunity features and evaluate them against the unchanged baseline with enough history; do not merely add complexity.
10. **Most improve user-perceived quality:** make stale/partial/unavailable evidence unmistakable, expose source/cutoff/sample explanations, and replace authoritative labels with precise evidence language.
11. **Engineering stronger than analytics?** Yes. Infrastructure, provenance, testing, and authorization are ahead of the current player, matchup, market-history, and evaluation layers.
12. **Exact work to close the gap:** fresh timestamped markets and closing archive; current depth/identity/OL evidence; historical injury impact; route/target/air-yard opportunity; retained prediction-level walk-forward results; and consumer displays that accurately reflect those evidence limits.

## Audit artifacts

- reports/gridline-current-state-audit.md (this report)
- reports/gridline-current-state-audit.json (machine-readable summary)
- reports/gridline-product-review-index.md (review guide)
- reports/product-review/production-games.png (real production capture)
- reports/gridline-2025-market-baseline.md/json
- reports/gridline-2025-personnel-comparison.md/json
- reports/cb-safety-edge-ol-depth-recovery-2026-09-16.md
- reports/gridline-confidence-ranking-framework.md
