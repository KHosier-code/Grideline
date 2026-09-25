# Gridline Player Usage missing statistics — repair and release evidence

**Date:** 2026-09-25  
**Status:** **BACKEND FIX READY** — the necessary API aggregation and consumer display changes are in development, **not yet published**. Do not describe production as fixed.

## Root cause and actual reproduction

The problem is **specific missing passing statistics**, not a missing 2026 import. Production shows real WR, RB and TE receiving/rushing statistics. But its persisted QB rows contain passing attempts, completions, yards and touchdowns while the `UsageRow` projection in the consumer API deliberately copied only receiving and rushing fields. `aggregatePlayerUsage` therefore never emitted passing fields. The generated usage response shape accepts arbitrary metric keys, but the API sent none; the frontend table, chart and Game Detail labels had no passing presentation. Production QBs such as Patrick Mahomes consequently appeared as **0 targets, 0 receptions, 9 carries, 40 rush yards and only 1 total TD**, concealing his actual **74 passing attempts, 47 completions, 566 pass yards and 5 pass TD** over completed weeks 1–2. Previously, “Total TD” summed only rushing and receiving touchdowns, so the passing touchdowns also disappeared from that figure.

This was reproduced, signed out, on the published desktop **Usage & Production** page by choosing **KC → QB → Last 3 games**. The browser actually requested `GET https://gridelineanalytics.com/api/consumer/player-usage?team=KC&position=QB&window=last3` and received **HTTP 200**, `status: available`, `season: 2026`, one player (Mahomes). His response `aggregate` had `carries: 9`, `rushingYards: 40`, `totalTd: 1`, `targets: 0` but **no** `attempts`, `completions`, `passingYards`, or `passingTds` keys. The rendered table had no passing columns. Those zero targets/receiving stats are source-backed zeros, **not** zeros for passing stats. A query string on `/usage` itself does not set filters; the page controls generate the API request.

Production SEA at WSH **`401872955`**, 2026 week 3, is an upcoming example with known completed weeks 1–2. Its published Game Detail “Key player usage” card showed Drew Lock with 2 carries/13 rush yards/0 total TD but no passing numbers. The Jaxon Smith-Njigba card correctly showed 22 targets/17 receptions/277 yards/4 total TD. Production SEA at ARI **`401872943`** is a completed week-2 example: its pregame cutoff must use week 1 only and never include its own week-2 stats. Published Game Detail player cards represent a *selected subset*, not the complete Player Usage table; the skill-position selection improvement was merged separately at `ce0aebed` but was not in the inspected published build.

The published service reported a successful public VM deployment at `https://gridelineanalytics.com`. The production runtime log identifies build `e37eaa8fc039-2026-09-25T20:36:41.744Z`; published HTML referenced `/assets/index-DN92b4gR.js`. Both published pages now contain the public Player Usage navigation. The current repair commit `1ce220aaf297e1124107591322587f8f031d85cc` is **later** than that deployment; the live UI/API inspection above reflects the older build, not the development correction. No production import, sync, or database change is indicated.

## Evidence at every stage

| Stage | What was observed |
| --- | --- |
| Production `player_game_stats` | Read-only production-replica SELECTs for 2026 REG weeks 1–2 showed Mahomes attempts `27+47`, completions `15+32`, passing yards `184+382`, passing TD `2+3`, carries `7+2`, rushing yards `23+17`, rushing TD `1+0`; Drew Lock attempts `22+26`, completions `16+19`, pass yards `187+235`, pass TD `1+3`. GSIS player IDs, canonical teams, season, season type and week were present. |
| Route query and joins | `GET /consumer/player-usage` selects the applicable 2026 season, maps ESPN schedule teams to NFLverse abbreviations, maps game identities by season/week/team/opponent, resolves snap PFR→GSIS player IDs, selects games before the chosen kickoff, then calls `aggregatePlayerUsage`. Game Detail `/consumer/games/:gameId` performs its own same-season recent-stat/snap aggregation before selecting `keyPlayers`. No projection or sportsbook market is required to query or render usage. |
| Data-loss boundary | The database's `attempts`, `completions`, `passing_yards`, `passing_tds` values existed, but `UsageRow` and the aggregation's `USAGE_METRICS`/per-game and aggregate maps omitted them. The QB total-TD formula also omitted `passingTds`. This is a backend response assembly defect, not a generated-client transformation or browser calculation. |
| Published consumer API | The actual browser KC/QB/last3 request above returned only rushing/receiving metrics. SEA/WR/last3 likewise returned HTTP 200 with Jaxon `22 / 17 / 277 / 4`, showing that other metrics and filters worked. Game Detail's `keyPlayers[].recentUsage` copied the incomplete aggregate. |
| Contract and client | OpenAPI `ConsumerUsagePlayer.aggregate` and `games[].metrics` are maps of `{value, available, reason}`; the generated `useGetConsumerPlayerUsage` hook passes `team`, `position`, `game`, `window` without dropping response keys. The Game Detail `ConsumerKeyPlayer.recentUsage` schema explicitly enumerated the former metrics. |
| Rendered components | `ConsumerUsage.tsx` used the generated hook but only rendered targets, receptions, receiving yards, carries, rush yards and total TD; its default targets sort and targets/carries chart also hid QB passing. `ConsumerKeyPlayers.tsx` only displays keys in `USAGE_METRIC_LABELS`, which lacked passing labels. Both need the backend fields before they can show pass production. |

## Source-backed statistical definitions and checks

For every selected completed team game before the selected game's kickoff (or before now with no game filter), the aggregator sums **finite, non-null** values of these `player_game_stats` fields. If *no* selected value exists it reports `{value:null, available:false}`; an observed zero remains `{value:0, available:true}`. An absent or zero denominator yields an unavailable efficiency ratio, not `0%`.

| Shown statistic | Source and calculation |
| --- | --- |
| QB pass attempts, completions, pass yards, pass TD | Sums of `attempts`, `completions`, `passing_yards`, `passing_tds` respectively. Newly exposed in the API, full usage table and QB Game Detail cards. QB trend/chart now use per-game passing yards. |
| RB/WR/TE targets, receptions, receiving yards | Sums of `targets`, `receptions`, `receiving_yards`; target share = player targets / team targets in the same selected games; yards/target = receiving yards / targets when targets > 0. |
| QB/RB/WR/TE carries, rushing yards | Sums of `carries`, `rushing_yards`; yards/carry = rushing yards / carries when carries > 0. |
| Touchdowns | `totalTd` = summed `passing_tds + rushing_tds + receiving_tds` where any of these source values exists. Pass TD is also displayed separately, so “Total TD” now includes QB passing TD without hiding rushing/receiving scores. |
| Snap share | Mean of available joined `snap_counts.offense_pct` for selected player games; missing snap evidence stays unavailable. |
| Red zone touches/targets, explosive rate | Unsupported by persisted source, so remain unavailable, never invented. |

Read-only production source→existing API examples for the upcoming week-3 cutoff (weeks 1–2 only):

| Team/position/player | Source weeks 1 + 2 | Existing published aggregate → corrected aggregate expectation |
| --- | --- | --- |
| SEA WR Jaxon Smith-Njigba | `11+11` targets; `8+9` rec; `122+155` rec yds; `1+3` rec TD | `22 / 17 / 277 / 4` already correct; remains correct. |
| SEA WR Cooper Kupp (additional WR) | `3+2` targets; `2+2` rec; `35+20` rec yds | `5 / 4 / 55` already correct; remains correct. |
| SEA QB Drew Lock | `22+26` att; `16+19` cmp; `187+235` pass yds; `1+3` pass TD; `2` carries/`13` rush yds | Published `0` total TD and no passing fields → `48` att, `35` cmp, `422` pass yds, `4` pass TD and **4 total TD**. |
| CLE RB Quinshon Judkins | `12+12` carries/`33+21` rush yds; `2+5` targets/`2+5` rec/`17+27` rec yds | `24 / 54` rushing and `7 / 7 / 44` receiving already correct; remains correct. |
| KC QB Patrick Mahomes | `27+47` att, `15+32` cmp, `184+382` pass yds, `2+3` pass TD; `7+2` carries, `23+17` rush yds, `1` rush TD | Published 9 carries/40 rush yards/1 total TD and no passing fields → `74` att, `47` cmp, `566` pass yds, `5` pass TD and **6 total TD**. |
| SEA TE AJ Barner (additional TE) | `2+1` targets, `2+1` rec, `13+8` rec yds; `1` carry/`1` rush yd/`1` rush TD | `3 / 3 / 21`, 1 rushing TD already correct; remains correct. |
| CAR RB Chuba Hubbard (additional RB) | `10+12` carries/`49+53` rush yds; `3+2` targets, `3+2` rec, `38+11` rec yds; 2 rec + 1 rush TD | `22 / 102` rushing and `5 / 5 / 49` receiving, 3 total TD already correct; remains correct. |
| CAR QB Bryce Young (additional QB) | `37+36` att, `23+23` cmp, `361+287` pass yds, `3+3` pass TD; 1 rush TD | Published no passing fields → `73` att, `46` cmp, `648` pass yds, `6` pass TD and **7 total TD**. |

The `last3` window currently has **two** eligible completed team games for these examples, not three; it must not pull in an older season or the future week-3 game to fill the window. SEA QB Sam Darnold has only a week-1 source appearance and retains individual partial coverage; low-sample SEA WR Montorie Foster Jr has one observed game and partial coverage, including source-backed zero values. The production 2026 multi-team-player query returned no examples, so team-change separation is regression-tested with an isolated two-team fixture rather than claimed verified with a live player.

## Corrective development changes

Commit **`1ce220aaf297e1124107591322587f8f031d85cc`**:

- `artifacts/api-server/src/routes/consumer.ts`: carry four existing passing source fields through aggregation, game series and QB trends; include passing TD in total TD; require persisted `STATUS_FINAL` for schedule-backed eligible games while preserving the existing source-chronology fallback when no schedule exists. Keep the selected game excluded and selected-season boundaries intact.
- `lib/api-spec/openapi.yaml` plus generated `lib/api-client-react/src/generated/api.schemas.ts`, `lib/api-zod/src/generated/api.ts`, and `lib/api-zod/src/generated/types/consumerKeyPlayerRecentUsage.ts`: add **optional nullable** passing properties to Game Detail `recentUsage` without breaking clients of the previous fields. Usage player metrics already permit keyed metrics. Codegen/typecheck completed.
- `artifacts/nfl-analytics/src/pages/consumer/ConsumerUsage.tsx`, `src/lib/consumer-usage.ts`, `src/lib/consumer-presentation.ts`, `src/components/ConsumerKeyPlayers.tsx`: show four passing columns, default QB sorting by pass yards, a QB passing-yards game chart and pass labels on QB cards. Non-QB cards do not add irrelevant zero-valued passing tiles. Constrain the expanded mobile table to horizontal scrolling inside its card.
- Focused backend/frontend tests in `artifacts/api-server/src/routes/consumer.test.ts` and `artifacts/nfl-analytics/src/lib/*.test.ts`.

**Verification:** API typecheck **passed**; consumer API/matchup suite **54/54 passed**, including passing source vs null/zero, final-status eligibility and cross-team grouping. Frontend typecheck **passed**; consumer presentation/usage tests **13/13 passed**. Production-mode Vite build **passed** (pre-existing non-fatal sourcemap/chunk-size notices). Both managed development workflows came up cleanly after the initial batch; the final changes were also typechecked/built. Signed-out development previews at **1440×900** and **390×844** confirm the page and controls fit after containment; the published 390px browser inspection showed the pre-fix overflow. Development has no matching 2026 player rows and honestly displays “No players found.” No data import was performed to populate that preview.

## Publish and verify

1. Publish the **main project containing commit `1ce220aaf297e1124107591322587f8f031d85cc`** via Replit's Publish interface; confirm its build succeeds and replaces the currently published `index-DN92b4gR.js` and API build `e37eaa8fc039-2026-09-25T20:36:41.744Z`. The merged Game Detail selection improvement at `ce0aebed` is included in this main commit's ancestry; do not reimplement it or import 2026 data again.
2. Signed out on desktop, visit `/usage`; select KC / QB / Last 3. Inspect the **actual network response** for `/api/consumer/player-usage?team=KC&position=QB&window=last3`: Mahomes must show attempts 74, completions 47, pass yards 566, pass TD 5, total TD 6, carries 9, rush yards 40. Check table columns, sort and expanded QB chart. Repeat SEA WR (Jaxon 22/17/277), SEA QB (Drew 48/35/422/4), CLE RB (Judkins 24/54 and 7/7/44), and SEA TE; verify unavailable values show a dash and observed zeros show 0.
3. Select upcoming SEA at WSH `401872955` in **Game context** and confirm only completed weeks 1–2 appear. Inspect `/games/401872955` Key player usage for Drew's passing and Jaxon's receiving regardless of projection/market state. Select completed SEA at ARI `401872943` and verify its **pregame** player usage excludes its own week-2 result. Check mobile at 390px: subtitle and card header should fit; scroll within the stat table to see passing and receiving columns without whole-page horizontal overflow.
4. Record the new published build and asset identity, HTTP results, screenshots and any browser-console errors. **Until the new build is live and its real populated page is checked, this is a development-ready fix, not a verified production repair.**

**Remaining limits:** A populated corrected browser render cannot be shown against the empty development database. The post-publish mobile table and individual passing tiles need live confirmation. No real 2026 player changed teams in the queried production sample; the regression test covers the grouping rule. No live no-projection example was identified; the Key player section is structurally independent of projections and sportsbook markets, and the published completed SEA–ARI detail returned players with a stale market. Prior raw-import byte and physical production-database identity questions remain outside this repair; the read-only records and live API agree for the named examples. No production writes, reimports, schema migrations, database-binding changes, model changes or sportsbook-history changes were made.

**FINAL STATUS: BACKEND FIX READY**