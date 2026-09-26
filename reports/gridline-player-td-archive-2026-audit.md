# 2026 nflverse archive asset and pregame-cutoff audit

**Feature-contract follow-up:** The [subsequent cutoff and training-provenance audit](gridline-player-td-feature-contract-provenance-followup.md) found that the model reads prior games relevant to each player/team/opponent, **not every earlier game in the league**. The league-wide completeness column below is a deliberately stronger diagnostic, not the implemented TD model's eligibility rule. A previous-week frozen comparison, the verified 2025 pre-Week-1 baseline, and an unusable December 2025 PBP asset are documented in that follow-up. No TD probabilities are approved.

**Checked:** September 26, 2026 (UTC). **Repository:** [`nflverse/nflverse-data-archives`](https://github.com/nflverse/nflverse-data-archives). **Method:** queried the public [GitHub releases API](https://api.github.com/repos/nflverse/nflverse-data-archives/releases?per_page=100&page=1), enumerated the assets in every `archive-2026-*` release on the first page, and initially selected `stats_player_reg_2026.rds` and `play_by_play_2026.rds`. Downloaded all six listed assets and compared the SHA-256 of their bytes with the API's `digest` field; all six matched. Times below are UTC. The usable time for an asset is the **latest** of release `published_at`, asset `created_at`, and asset `updated_at`, not the date in the tag. A release name is not evidence that its assets were present at midnight of that date.

**Correction:** `stats_player_reg_2026.rds` is a **season summary**, not player-game evidence. Its timestamps and digests below are retained as an audit trail, but **none of its rows may be used as weekly player-stat inputs**. The weekly asset `stats_player_week_2026.rds` and actual row audit appear below. The original Week 2/3 timing finding must be read as provisional until the weekly asset's own timestamps and content are checked.

| Release | Release `published_at` | Asset | Asset `created_at` | Asset `updated_at` | GitHub SHA-256 (`digest`, independently matched against downloaded bytes) |
|---|---|---|---|---|---|
| [`archive-2026-09-10`](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-10) | 2026-09-10 18:24:20 | `stats_player_reg_2026.rds` | 2026-09-10 18:25:51 | 2026-09-10 18:25:52 | `4094008b7d923fd7fea73144b1de4816acf9a676c0bb3676767b998013bda40d` |
| [`archive-2026-09-10`](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-10) | 2026-09-10 18:24:20 | `play_by_play_2026.rds` | 2026-09-10 18:30:47 | 2026-09-10 18:30:48 | `d1b51bc39af0a84372eb7261999612a7ef27beb35c53d340bfe8424bef05e82f` |
| [`archive-2026-09-17`](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-17) | 2026-09-17 19:00:20 | `stats_player_reg_2026.rds` | 2026-09-17 19:02:10 | 2026-09-17 19:02:10 | `dee3c2d833c2b040b2687c19265453bae38a5946f4db832f3a998170365422d5` |
| [`archive-2026-09-17`](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-17) | 2026-09-17 19:00:20 | `play_by_play_2026.rds` | 2026-09-17 19:10:47 | 2026-09-17 19:10:48 | `440385c901f1ad1f1bd53db60fde1649bf263226420e39785ae0dc9b8177bdcf` |
| [`archive-2026-09-24`](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-24) | 2026-09-24 19:06:19 | `stats_player_reg_2026.rds` | 2026-09-24 19:08:37 | 2026-09-24 19:08:37 | `10fac30decaf6ac44ac9381e3dd914277c74b1cc3128fd560efeb01856806bbb` |
| [`archive-2026-09-24`](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-24) | 2026-09-24 19:06:19 | `play_by_play_2026.rds` | 2026-09-24 19:12:25 | 2026-09-24 19:12:25 | `8c204b5372ab337219227f2935ed8235952a348d8c10129c18e8b9af72b9a637` |

The `archive-2026-09-03` release (published 2026-09-03 18:35:42 UTC) has **neither** of these 2026 assets. Earlier `archive-2026-*` releases in the API result also lack both exact 2026 assets. There is no evidenced pair before the first 2026 regular-season kickoff.

## Week-level temporal result

The comparison uses the development `games` schedule's explicit `kickoff_time`, not the date label. It verifies asset availability only, **not** that every row in either `.rds` is complete, that rows agree with today's imports, that a roster/injury state is known, or that the 2021–2025 model training releases were available at their original cutoffs.

| 2026 regular-season week | Schedule's first kickoff (UTC) | Relevant paired archive | Later of paired asset availability times (UTC) | Result for a full-week pregame snapshot |
|---|---|---|---|---|
| 1 | Sep 10 00:20 | Sep 10 (Sep 03 has no pair) | Sep 10 18:30:48 | **Fail** for the first game. The Sep 10 pair was available before the other 15 scheduled games (subject to game-by-game row checks), but **not** before all 16 kickoffs. Do not describe Week 1 as fully covered. |
| 2 | Sep 18 00:15 | Sep 17 | Sep 17 19:10:48 | **Pass, asset timing only:** both exact versions were available before all 16 scheduled Week 2 kickoffs. |
| 3 | Sep 25 00:15 | Sep 24 | Sep 24 19:12:25 | **Pass, asset timing only:** both exact versions were available before all 16 scheduled Week 3 kickoffs. |
| 4 | Oct 02 00:15 | none following completed Week 3 as of this audit | — | **Pending**, not a pass for complete prior-week evidence. The Sep 24 pair precedes Week 4 but was uploaded before Week 3 began; it cannot be assumed to contain completed Week 3 inputs. |

**Use rule:** before scoring a particular game, match both asset digests to the chosen dated release; require `max(published_at, both assets' created_at and updated_at) < min(request as-of, scheduled kickoff)` and inspect the archived bytes to establish covered game/week rows. Exclude the predicted game's own rows and any other post-cutoff games. For a Week 1 game after Thursday, the Sep 10 pair may contribute Thursday data only if the archived files actually contain it and the exact upload preceded that game's kickoff. A Thursday Week 1 prediction cannot use that pair. Do not backdate current nflverse files to a past release.

**Remaining gates after the expanded row audit below:** bind the qualified asset bytes and metadata immutably to the project's evidence workflow; inspect historical training releases at every fitted cutoff and refit/re-evaluate against qualified bytes; separately qualify current player/team/availability/depth at each target cutoff. The 2021–2025 training/evaluation chronology remains unapproved. No production import or backfill was performed.

## Corrected weekly-stat and play-by-play asset evidence

The same three releases also contain `stats_player_week_2026.rds`. This file has `season`, `week`, `season_type`, `game_id`, `player_id`, `team`, `opponent_team`, `position`, targets, carries, and distinct passing/rushing/receiving TD fields. One row is a player's appearance in a particular game, **not** a season summary. The paired PBP file has `game_id`, `play_id`, week, offense/defense team, rusher/receiver IDs, and TD flags. Every weekly-stat and PBP SHA-256 below was independently recomputed from the downloaded asset and matched the GitHub API digest. Asset IDs are GitHub release asset IDs. The original season-summary table above must not substitute for this one.

| Pair key | Release `published_at` UTC | Weekly asset ID; `created_at` / `updated_at`; SHA-256 | PBP asset ID; `created_at` / `updated_at`; SHA-256 | Effective pair time UTC |
|---|---|---|---|---|
| A: [Sep 10](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-10) | Sep 10 18:24:20 | `555566630`; 18:25:58 / 18:25:59; `26a0c1084fb2a2a18111509cf66e9c8cd8dc1f0acde6448fe31018f26cc05554` | `555575767`; 18:30:47 / 18:30:48; `d1b51bc39af0a84372eb7261999612a7ef27beb35c53d340bfe8424bef05e82f` | Sep 10 18:30:48 |
| B: [Sep 17](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-17) | Sep 17 19:00:20 | `570894660`; 19:02:18 / 19:02:18; `661fb29b37205fe3e0469b5a279d03c5c96fa8a1ba24799275b21e560c47d83c` | `570909606`; 19:10:47 / 19:10:48; `440385c901f1ad1f1bd53db60fde1649bf263226420e39785ae0dc9b8177bdcf` | Sep 17 19:10:48 |
| C: [Sep 24](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-24) | Sep 24 19:06:19 | `586627614`; 19:08:44 / 19:08:45; `035cb9908bfbad6b1fcc32b75b97f94a05ffddf388db44625280b0f5aab019ce` | `586634881`; 19:12:25 / 19:12:25; `8c204b5372ab337219227f2935ed8235952a348d8c10129c18e8b9af72b9a637` | Sep 24 19:12:25 |

For each pair, the effective time is `max(release.published_at, weekly.created_at, weekly.updated_at, pbp.created_at, pbp.updated_at)`. A has **67** weekly rows / **166** PBP rows, both for the first Week 1 game only. B has **1,118** / **2,756**, spanning all **16 Week 1** games. C has **2,225** / **5,489**, spanning all **16 Week 1 + 16 Week 2** games; it has **no Week 3 rows**. These are cumulative archives, not new rows per release. The two weekly rows without `player_id` are one in `2026_01_NE_SEA` and one in `2026_02_DET_BUF`; both have null name/position and zero targets, carries and all TD fields. They cannot be assigned to a player and must not become eligible QB/RB/WR/TE observations.

For all three versions, `(game_id, play_id)` in PBP has zero duplicates and zero missing components; `(game_id, player_id)` among identified weekly rows has zero duplicates. In C, **32/32** completed games have both sets of rows. Using the nflverse schedule's `espn` field, all 32 games map uniquely to Gridline's ESPN game ID. For those games, all **2,223 identified weekly rows** match the persisted player, week, team and opponent; every row's targets, carries, passing TDs, rushing TDs and receiving TDs matches Gridline's current completed-game records. This is a **comparison with current data, not proof that current data existed before kickoff**. Each game's archived rushing TD and receiving TD counts match PBP rush and pass TD flags; all **56 rushing** and **101 receiving** scorer IDs in C resolve to the same weekly player/game. The last PBP home/away score matches Gridline's final score for all 32 games. QB passing TDs (101 in C) were compared for consistency, but are **not** anytime scoring TD labels. Team aliases `LA`/`LAR` and `WAS`/`WSH` were reconciled, not treated as new teams. For the covered Week 1+2 games, the QB/RB/WR/TE subset also has zero per-player differences for those five fields (76 QB, 184 RB, 303 WR and 153 TE rows).

### Game-by-game rows in archive C (Sep 24)

The counts are weekly-stat rows (**keyed player rows** in parentheses) and PBP rows, not TD counts. The first game is also present in A; all Week 1 games are present in B. No Week 3 game has either set of rows in C. All 32 listed games passed the per-game score, TD and identified-player reconciliation checks above. An absent game in a selected **pregame** pair remains missing even if it appears in a later release.

| Week | nflverse `game_id` | Weekly rows (keyed) | PBP rows |
|---|---|---:|---:|
| 1 | `2026_01_ARI_LAC` | 68 (68) | 173 |
| 1 | `2026_01_ATL_PIT` | 71 (71) | 175 |
| 1 | `2026_01_BAL_IND` | 67 (67) | 167 |
| 1 | `2026_01_BUF_HOU` | 75 (75) | 180 |
| 1 | `2026_01_CHI_CAR` | 74 (74) | 196 |
| 1 | `2026_01_CLE_JAX` | 69 (69) | 148 |
| 1 | `2026_01_DAL_NYG` | 70 (70) | 165 |
| 1 | `2026_01_DEN_KC` | 77 (77) | 160 |
| 1 | `2026_01_GB_MIN` | 72 (72) | 180 |
| 1 | `2026_01_MIA_LV` | 69 (69) | 169 |
| 1 | `2026_01_NE_SEA` | 67 (66) | 166 |
| 1 | `2026_01_NO_DET` | 71 (71) | 218 |
| 1 | `2026_01_NYJ_TEN` | 64 (64) | 162 |
| 1 | `2026_01_SF_LA` | 68 (68) | 157 |
| 1 | `2026_01_TB_CIN` | 67 (67) | 169 |
| 1 | `2026_01_WAS_PHI` | 69 (69) | 171 |
| 2 | `2026_02_CAR_ATL` | 75 (75) | 171 |
| 2 | `2026_02_CIN_HOU` | 68 (68) | 193 |
| 2 | `2026_02_CLE_TB` | 65 (65) | 172 |
| 2 | `2026_02_DET_BUF` | 72 (71) | 184 |
| 2 | `2026_02_GB_NYJ` | 68 (68) | 184 |
| 2 | `2026_02_IND_KC` | 69 (69) | 202 |
| 2 | `2026_02_JAX_DEN` | 68 (68) | 159 |
| 2 | `2026_02_LV_LAC` | 76 (76) | 177 |
| 2 | `2026_02_MIA_SF` | 75 (75) | 151 |
| 2 | `2026_02_MIN_CHI` | 69 (69) | 164 |
| 2 | `2026_02_NO_BAL` | 66 (66) | 163 |
| 2 | `2026_02_NYG_LA` | 63 (63) | 155 |
| 2 | `2026_02_PHI_TEN` | 68 (68) | 170 |
| 2 | `2026_02_PIT_NE` | 70 (70) | 165 |
| 2 | `2026_02_SEA_ARI` | 66 (66) | 157 |
| 2 | `2026_02_WAS_DAL` | 69 (69) | 166 |

### Per-game cutoff matrix (2026 Weeks 1–3)

One row per scheduled game. This table deliberately tests a **league-wide prior-game denominator, not the existing TD feature contract**; see the linked follow-up for the actual per-game and proposed weekly-frozen counts. The `weekly/PBP` column names the **same exact pair** from the asset table; `—` means neither *2026-season* version existed before kickoff. Pair A contains the first Week 1 game, B contains all Week 1 games, and C contains all Week 1 and Week 2 games. `Prior covered` counts earlier **scheduled kickoff** games with both source row sets, out of every earlier Week 1–3 kickoff; simultaneous games are not counted against each other. `Reconcile` means that all games actually present in the selected pair match the source-to-PBP-to-current-Gridline checks above; it does **not** claim that omitted earlier games were covered. Each selected pair excludes the target game and any later game, so there are zero unexpected target/future-game rows. UTC times are compared to each pair's effective availability time, not the tag date.

| W | Gridline ID / nflverse ID | Kickoff UTC (2026) | Weekly/PBP | League-wide prior covered | Row completeness / reconciliation | League-wide diagnostic |
|---|---|---|---|---:|---|---|
| 1 | `401872656` / `2026_01_NE_SEA` | Sep 10 00:20 | — | 0/0 | no pregame pair | fail |
| 1 | `401872657` / `2026_01_SF_LA` | Sep 11 00:35 | A/A | 1/1 | complete prior game; reconciled | candidate |
| 1 | `401872658` / `2026_01_ATL_PIT` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872659` / `2026_01_BAL_IND` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872660` / `2026_01_BUF_HOU` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872661` / `2026_01_CHI_CAR` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872922` / `2026_01_CLE_JAX` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872923` / `2026_01_NO_DET` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872924` / `2026_01_NYJ_TEN` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872925` / `2026_01_TB_CIN` | Sep 13 17:00 | A/A | 1/2 | Friday game missing; present game reconciled | partial |
| 1 | `401872926` / `2026_01_ARI_LAC` | Sep 13 20:25 | A/A | 1/10 | 9 prior games missing; present game reconciled | partial |
| 1 | `401872927` / `2026_01_GB_MIN` | Sep 13 20:25 | A/A | 1/10 | 9 prior games missing; present game reconciled | partial |
| 1 | `401872928` / `2026_01_MIA_LV` | Sep 13 20:25 | A/A | 1/10 | 9 prior games missing; present game reconciled | partial |
| 1 | `401872929` / `2026_01_WAS_PHI` | Sep 13 20:25 | A/A | 1/10 | 9 prior games missing; present game reconciled | partial |
| 1 | `401872930` / `2026_01_DAL_NYG` | Sep 14 00:20 | A/A | 1/14 | 13 prior games missing; present game reconciled | partial |
| 1 | `401872931` / `2026_01_DEN_KC` | Sep 15 00:15 | A/A | 1/15 | 14 prior games missing; present game reconciled | partial |
| 2 | `401872932` / `2026_02_DET_BUF` | Sep 18 00:15 | B/B | 16/16 | complete Week 1; reconciled | candidate |
| 2 | `401872933` / `2026_02_CAR_ATL` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872934` / `2026_02_CIN_HOU` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872935` / `2026_02_CLE_TB` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872936` / `2026_02_GB_NYJ` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872937` / `2026_02_MIN_CHI` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872938` / `2026_02_NO_BAL` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872939` / `2026_02_PHI_TEN` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872946` / `2026_02_PIT_NE` | Sep 20 17:00 | B/B | 16/17 | Thursday game missing; present games reconciled | partial |
| 2 | `401872940` / `2026_02_JAX_DEN` | Sep 20 20:05 | B/B | 16/25 | 9 prior Week 2 games missing; present games reconciled | partial |
| 2 | `401872941` / `2026_02_LV_LAC` | Sep 20 20:05 | B/B | 16/25 | 9 prior Week 2 games missing; present games reconciled | partial |
| 2 | `401872942` / `2026_02_MIA_SF` | Sep 20 20:25 | B/B | 16/27 | 11 prior Week 2 games missing; present games reconciled | partial |
| 2 | `401872943` / `2026_02_SEA_ARI` | Sep 20 20:25 | B/B | 16/27 | 11 prior Week 2 games missing; present games reconciled | partial |
| 2 | `401872944` / `2026_02_WAS_DAL` | Sep 20 20:25 | B/B | 16/27 | 11 prior Week 2 games missing; present games reconciled | partial |
| 2 | `401872945` / `2026_02_IND_KC` | Sep 21 00:20 | B/B | 16/30 | 14 prior Week 2 games missing; present games reconciled | partial |
| 2 | `401872947` / `2026_02_NYG_LA` | Sep 22 00:15 | B/B | 16/31 | 15 prior Week 2 games missing; present games reconciled | partial |
| 3 | `401872948` / `2026_03_ATL_GB` | Sep 25 00:15 | C/C | 32/32 | complete Weeks 1–2; reconciled | candidate |
| 3 | `401872949` / `2026_03_CAR_CLE` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872950` / `2026_03_CIN_PIT` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872951` / `2026_03_HOU_IND` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872952` / `2026_03_KC_MIA` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872953` / `2026_03_LAC_BUF` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872954` / `2026_03_NYJ_DET` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872955` / `2026_03_SEA_WAS` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872956` / `2026_03_TEN_NYG` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872957` / `2026_03_NE_JAX` | Sep 27 17:00 | C/C | 32/33 | Thursday game missing; present games reconciled | partial |
| 3 | `401872958` / `2026_03_ARI_SF` | Sep 27 20:05 | C/C | 32/42 | 10 prior Week 3 games missing; present games reconciled | partial |
| 3 | `401872959` / `2026_03_MIN_TB` | Sep 27 20:05 | C/C | 32/42 | 10 prior Week 3 games missing; present games reconciled | partial |
| 3 | `401872960` / `2026_03_BAL_DAL` | Sep 27 20:25 | C/C | 32/44 | 12 prior Week 3 games missing; present games reconciled | partial |
| 3 | `401872961` / `2026_03_LV_NO` | Sep 27 20:25 | C/C | 32/44 | 12 prior Week 3 games missing; present games reconciled | partial |
| 3 | `401872962` / `2026_03_LA_DEN` | Sep 28 00:20 | C/C | 32/46 | 14 prior Week 3 games missing; present games reconciled | partial |
| 3 | `401872963` / `2026_03_PHI_CHI` | Sep 29 00:15 | C/C | 32/47 | 15 prior Week 3 games missing; present games reconciled | partial |

**Interpretation:** This league-wide test yields three complete, 44 partial and one without a same-season pair, but **must not be used as the TD model gate**: another team's earlier same-week result is not an input to this player's features. The first Week 1 game also has a pregame *prior-season* pair even though no 2026 weekly file yet exists. The linked follow-up re-evaluates all 48 games against actual feature dependencies. **None of the 48 games passes the full TD-model gate**, which separately needs verified training history, participation/availability and release approval. C predates Week 3: a later import of the first Week 3 game into Gridline cannot be substituted for a pregame archived version of C.

## 2021–2025 training-source inventory

Read **both pages** of the public GitHub releases API (100 + 26 releases) and considered the asset names actually in use in each era: `player_stats_player_stats_{season}.rds`, `player_stats_{season}.rds`, `stats_player_week_{season}.rds` for player-game stats, and `pbp_play_by_play_{season}.rds` or `play_by_play_{season}.rds` for PBP. This prevents the later filename scheme from hiding earlier releases. Before naming an archived weekly file as player-game data, downloaded representative versions: the 2022 Oct 20, 2023 Sep 14, 2024 Sep 12 and Nov 09 player-stat assets all have season/week/player and opponent but **no `game_id`**; the 2024 Nov 21 `stats_player_week` asset likewise lacks `game_id`. Their PBP assets do have `game_id` and `play_id`. The 2025 Sep 11 `stats_player_week` asset has 1,071 Week 1 rows but still no `game_id`; its PBP has 2,738 rows across 16 games. Unlike 2026, those player appearances need an independently checked season/week/team/opponent-to-game mapping; filenames alone do not prove identity.

The table reports a **same-season pair's metadata availability before the first scheduled kickoff of each regular-season week**. Historical kickoff times come from the nflverse `games.rds` schedule in the Sep 24, 2026 archive (GitHub SHA-256 `c604f6b96d0704e5db9fdebcc3d7fdcac53e2bb51f473a77fc49f24da7e8f7a3`, independently matched), with `gameday` + Eastern `gametime` converted to UTC. This schedule is a later snapshot; it is useful for this inventory, but not a substitute for independently archived historical kickoff changes. Each "candidate" week has at least one release with **both** season-specific assets' latest release/upload/update time before its first kickoff; later releases cannot qualify an earlier cutoff. These are **not** validated player-TD training weeks: except for the representative samples above, old-season per-game rows and hashes have not been audited or bound to the training report.

| Season | Same-season pair existed before first kickoff in weeks | No pair before first kickoff | Further gaps and exact verdict |
|---|---|---|---|
| 2021 | **None (0/18)** | W1–18 | No dated 2021 archive releases in the API result. Later files labeled `2021` cannot prove 2021 pregame publication. Strict training provenance **fails all 18 weeks**. |
| 2022 | **W7–18 (12/18)** | W1–6 | First located pair is Oct 20 (before W7); its downloaded player stats reach W6. W8 reuses Oct 20 because Oct 27 has no pair, so it **lacks W7**. GitHub API `digest` is null for the sampled 2022 assets: the SHA-256 calculated from today's download does not establish the bytes originally published in 2022. No training week is fully attested. |
| 2023 | **W2–18 (17/18)** | W1 | Sep 14 pair has 313 player rows from W1. W12 reuses Nov 16 and lacks W11; W14 reuses Nov 30 and lacks W13. Sampled 2023 assets also have null API digests and no weekly `game_id`. No training week is fully attested. |
| 2024 | **W2–18 (17/18)** | W1 | Sep 12 pair has 310 W1 player rows. W6 reuses Oct 03 and lacks W5; W9 reuses Oct 24 and lacks W8; W16–17 reuse Dec 12 and lack intervening weeks; W18's Dec 26 pair preceded completion of all W17 games, so it is also incomplete for a full prior-week input. Sampled early 2024 assets have null API digests and no weekly `game_id`. No training week is fully attested. |
| 2025 | **W2–18 (17/18) by metadata only** | W1 | The Sep 11 pair was SHA-256 matched against both non-null API digests and contains W1 rows before W2. The [follow-up](gridline-player-td-feature-contract-provenance-followup.md) verifies all 17 selected pairs: the Dec 11 PBP asset for W15–16 is **HTML, not RDS**, despite its matching digest, and W16 also lacks Week 15 stats. No week is promoted to the 2021–2025 walk-forward model solely from these 2025 observations. |

**Important distinction:** an asset created/uploaded before kickoff with no historical API digest can still have useful publication-time metadata; it is not proof that the bytes downloaded today are the same as the originally uploaded version. Conversely, a non-null digest and timely asset do not establish row completeness, player/team availability or that the model actually used those bytes. The previous 2021–2025 evaluation was fitted and scored from present Gridline imports, not these archived assets. Refit, re-evaluate and approve on a qualified immutable historical cohort before treating its 8,139 retrospective evaluations as a point-in-time backtest. This audit made **no database writes, production changes or provider calls**; observed Defense vs Position is not a player TD forecast.