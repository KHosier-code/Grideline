# Player TD cutoff contract and training-archive follow-up

**Checked:** September 26, 2026 UTC. This is a read-only qualification of the experimental player-scoring-TD model and the public nflverse-data-archives assets. It supersedes the **league-wide completeness interpretation**, but not the asset/row evidence, in the [2026 archive audit](gridline-player-td-archive-2026-audit.md). It does not certify live forecasts or a point-in-time backtest.

## What the existing code actually requires

`player-td-model.ts` declares `predictionCutoff: "strictly before target kickoff; target game excluded by identity"`. `rowsBefore` applies this cutoff **per target game**, not once at the start of its week. For 2021–2024, `isStrictlyPreKickoff` conservatively compares calendar dates because the development adapter has no archived kickoff times; for 2025+ it uses scheduled kickoff. A game date proves chronology of play, **not** publication of its source rows. The evaluation adapter reads current mutable 2021–2025 imports and has no per-release byte provenance. The existing fitting plan trains on 2021–2023, calibrates on 2024 W1–9 (fallback 2023 W10–18), and evaluates on 2024 W10+ and 2025. No ffopportunity or named CB feature is active.

| Input to scoring or eligibility | Actual pregame dependency and cutoff | Weekly-frozen equivalent? |
|---|---|---|
| Player's last 3/6 targets and carries, trends, last TD labels/rate/count, and minimum three prior appearances | `rowsBefore(playerHistory, target)` includes any prior appearance, including an earlier **same-week** game if a player changes team and appears twice. The target game's rushing/receiving TD fields are only its **evaluation label**; passing TD is excluded. | Not generally: exclude the earlier same-week appearance and its red-zone facts under a new version. |
| Player's zone-20 target/carry shares and coverage | Facts must join a valid covered appearance in that same player history. An absent fact is unavailable, never a true zero. Current 2021–2025 development evaluation excludes red-zone features when no verified training coverage exists. | Same exception for a player appearing twice in the week. PBP coverage and fact construction also need their own release audit. |
| Own-team and opponent's last three scores; opponent's last five defensive EPA values | `rowsBefore(teamGames, target)` for each of the two teams, not league-wide scores or a same-week league average. | Equal if each team has played at most once that week; otherwise different. Defensive EPA is a derived team-game input, not verified just by possession of PBP bytes. |
| Opponent defense vs prior WR1 and other-WR scoring TD rates and sample counts | `historicalWrScoringRates` selects prior WR appearances **against that opponent team** only. `precomputeWr1Roles` classifies each prior WR from earlier same-team-season targets, allowing earlier games on the same day when exact times exist. `candidateWr1Role` uses current-season targets from that WR's team before the target kickoff. No individual CB assignment is inferred. | Equal under one game per team per week; not guaranteed with unusual repeated team/player appearances. First-week current-season WR1 is legitimately unavailable. |
| Position/player/team-opponent baselines, ridge model and Platt calibrator | Fit from fixed historical training/calibration seasons; not refreshed with current-week games during evaluation. `preparePlayerTdExamples` still constructs every example using its per-game cutoff. | Coefficients are fixed, but changing example features requires a separately versioned fit/evaluation. |
| Identity, final-game labels, schedule, availability and roster | Adapter resolves season/week/team/opponent to one completed game; live eligibility and availability are separate readiness gates and cannot be inferred from last year's roster. | The model has no weekly-frozen roster/injury contract to reuse. |

**Classification:** Every *variable historical feature* is per-game; no feature is explicitly frozen at the first kickoff of a week. Fixed fitted parameters and season-only baselines are not same-week refreshes. Historical 2021–2024 calendar-boundary rows and 2025+ exact kickoff rows use different time **precision**, but neither is a weekly freeze. Thus changing to weekly-frozen would change the feature contract, not just relax a validation flag. No model or route was changed in this audit.

## Re-evaluation of 48 scheduled 2026 games

The old 48-row table asked whether **all earlier league games** were in each 2026 pair. That is not what `featuresFor` consumes. The actual source requirements are the candidate's past appearances, the two teams' past games, opponent's prior WR games, and their joined red-zone facts where qualified. The development schedule has 16 games and **no team with two games** in each of Weeks 1–3; the identified players in archived Weeks 1–2 have **zero** cross-game same-week repeats. Consequently an earlier game involving *other teams* is not a missing model input. A future Week 3 player trade or previously unverified team/player identity could change an individual decision, so this is a conditional source-coverage analysis, not certification of all 48 player cohorts.

Before Week 1, [Sep 3](https://github.com/nflverse/nflverse-data-archives/releases/tag/archive-2026-09-03) has **no 2026 weekly/PBP pair**, but does contain a 2025 weekly-stat/PBP pair uploaded by **2026-09-03 18:42:33 UTC**, before the Sep 10 00:20 first kickoff. Weekly asset `543177644` was uploaded at 18:38:22 (SHA-256 `f658cb209d65af4a0521cd482fc9c6da24ebdfd3a61b77c9275076d6f2eaecb7`); PBP asset `543182528` was uploaded at 18:42:33 (SHA-256 `fb44829609797a3f5e3db126833bcecf771a6264c400b79d4bbcb61a4c91830b`). Both downloaded files matched their API SHA-256 digests. The 2025 regular-season portion contains **272/272 scheduled games** in each source, 18,540 weekly rows (18 unkeyed) and 46,452 PBP rows. Identified weekly `(game_id,player_id)` and PBP `(game_id,play_id)` keys have zero duplicates; rushing/receiving TD totals are 510/811 in both sources. Its weekly file **has `game_id`**, unlike the September 2025 version of the 2025 file. These are usable *2026 pre-Week-1 prior-season timing and row candidates*, **not** evidence of what was available during 2025. Prior 2021–2024 histories, team EPA/red-zone derivation and current 2026 personnel still need qualification.

| Target week and games (the original matrix has each ID/kickoff) | Latest week-start pair used for 2026 prior-week evidence | Pair available before first kickoff? | Prior 2026 games covered by both pair files | Current per-game **relevant-game** source-timing candidates | Hypothetical weekly-frozen source-timing candidates |
|---|---|---|---|---:|---:|
| W1, 16 games | No same-season pair needed; Sep 3 **2025** pair supplies prior-season history. The Sep 10 pair is only after the first game. | Sep 3 pair: yes, **6 days** before first kickoff | 0/0 | 16/16 **conditional** on all older relevant history | 16/16 **conditional**, same baseline |
| W2, 16 games | Sep 17 pair B, effective Sep 17 **19:10:48 UTC**; first kickoff Sep 18 **00:15 UTC** | Yes, **5h 04m 12s** before first kickoff | 16/16 W1 | 16/16 conditional | 16/16 conditional |
| W3, 16 games | Sep 24 pair C, effective Sep 24 **19:12:25 UTC**; first kickoff Sep 25 **00:15 UTC** | Yes, **5h 02m 35s** before first kickoff | 32/32 W1–2 | 16/16 conditional | 16/16 conditional |
| **Total** | | | | **48/48 timing/covered-game candidates; 0/48 fully qualified forecasts** | **48/48 timing/covered-game candidates; 0/48 fully qualified forecasts** |

**Difference from the old league-wide diagnostic:** it found only three complete games, 44 partial games and one with no *2026-season* pair. The 44 missing earlier same-week **other-team** games are not dependencies of the current features. The first Week 1 game's 2025 prior-season pair is real and precedes kickoff. Reclassifying these as *conditional candidates* does not make the model backtested or live-ready. The candidate counts match between current and hypothetical weekly-frozen rules in the verified 2026 team schedule and identified Weeks 1–2 player rows; the **definition still differs** for a repeat player/team in the same week, and the 15 not-yet-played Week 3 games cannot prove no such future identity changes. Do not exclude same-week evidence while claiming to run the current code. Conversely, do not call intentionally excluded same-week results "missing" under a newly specified freeze. A fully reproducible weekly-frozen model would require a separately versioned feature implementation, training rebuild, and held-out evaluation.

The 2026 pair confirms weekly stats and PBP rows, not the completeness, release times, and transformations for every scored feature (2021–2025 history, team defensive EPA, red-zone coverage), nor verified player/roster/injury status. Thus **both full-gate counts remain zero**, regardless of the corrected source-timing counts.

## Historical release inventory and strict verdict

Metadata source: 126 public archive releases across both GitHub API pages, including each selected release's `published_at` and **both** assets' `created_at`/`updated_at`; the effective UTC timestamp below is their maximum. Selection is the latest complete same-season stat/PBP pair *before the first kickoff* of the listed week, not the tag date. Kickoffs come from `games.rds` as archived Sep 24, 2026 (retrospective schedule; prior revisions unverified). The paired asset IDs resolve the exact names: 2022–23 use `player_stats_player_stats_{year}.rds` and `pbp_play_by_play_{year}.rds`; 2024 changes filename scheme (resolve IDs through the cited release); 2025 uses `stats_player_week_2025.rds` and `play_by_play_2025.rds`. In every row, **S/P** means weekly player-stat/PBP asset IDs. "No pair" means no same-season pair; Week 1 may still use an older-season baseline, which needs its own cutoff audit.

**2021:** W1–W18: no dated same-season pair in the public archive before any week's first kickoff; no saved 2021 as-published training bytes are evidenced. Strict 2021 walk-forward training/evaluation is unsupported.

| Cutoff | First kickoff UTC | Release tag | S/P asset IDs | Effective availability UTC | Both GitHub digests |
|---|---|---|---|---|---|
| 2022 W1 | Sep 9 00:20 | — | — | — | no pair |
| 2022 W2 | Sep 16 00:15 | — | — | — | no pair |
| 2022 W3 | Sep 23 00:15 | — | — | — | no pair |
| 2022 W4 | Sep 30 00:15 | — | — | — | no pair |
| 2022 W5 | Oct 7 00:15 | — | — | — | no pair |
| 2022 W6 | Oct 14 00:15 | — | — | — | no pair |
| 2022 W7 | Oct 21 00:15 | 2022-10-20 | 81692482/81692782 | Oct 20 15:59:48 | null |
| 2022 W8 | Oct 28 00:15 | 2022-10-20 | 81692482/81692782 | Oct 20 15:59:48 | null; **W7 absent** |
| 2022 W9 | Nov 4 00:15 | 2022-11-03 | 83321136/83321367 | Nov 3 15:56:17 | null |
| 2022 W10 | Nov 11 01:15 | 2022-11-10 | 84156551/84156917 | Nov 10 15:40:27 | null |
| 2022 W11 | Nov 18 01:15 | 2022-11-17 | 84981408/84981754 | Nov 17 15:40:08 | null |
| 2022 W12 | Nov 24 17:30 | 2022-11-24 | 85839229/85839501 | Nov 24 15:38:08 | null |
| 2022 W13 | Dec 2 01:15 | 2022-12-01 | 86642884/86643302 | Dec 1 15:38:38 | null |
| 2022 W14 | Dec 9 01:15 | 2022-12-08 | 87478465/87478902 | Dec 8 15:35:46 | null |
| 2022 W15 | Dec 16 01:15 | 2022-12-15 | 88328248/88328657 | Dec 15 15:37:08 | null |
| 2022 W16 | Dec 23 01:15 | 2022-12-22 | 89165935/89166196 | Dec 22 15:36:25 | null |
| 2022 W17 | Dec 30 01:15 | 2022-12-29 | 89875440/89875641 | Dec 29 15:33:24 | null |
| 2022 W18 | Jan 7 21:30 | 2023-01-05 | 90615789/90616025 | Jan 5 15:37:29 | null |
| 2023 W1 | Sep 8 00:20 | — | — | — | no pair |
| 2023 W2 | Sep 15 00:15 | 2023-09-14 | 126050031/126052791 | Sep 14 16:10:51 | null |
| 2023 W3 | Sep 22 00:15 | 2023-09-21 | 127110157/127113948 | Sep 21 16:18:54 | null |
| 2023 W4 | Sep 29 00:15 | 2023-09-28 | 128168518/128172340 | Sep 28 16:24:54 | null |
| 2023 W5 | Oct 6 00:15 | 2023-10-05 | 129199898/129202991 | Oct 5 16:24:05 | null |
| 2023 W6 | Oct 13 00:15 | 2023-10-12 | 130282382/130286001 | Oct 12 16:28:40 | null |
| 2023 W7 | Oct 20 00:15 | 2023-10-19 | 131395636/131399606 | Oct 19 16:26:46 | null |
| 2023 W8 | Oct 27 00:15 | 2023-10-26 | 132494643/132498563 | Oct 26 16:28:23 | null |
| 2023 W9 | Nov 3 00:15 | 2023-11-02 | 133618451/133623179 | Nov 2 16:36:25 | null |
| 2023 W10 | Nov 10 01:15 | 2023-11-09 | 134769484/134772646 | Nov 9 18:20:13 | null |
| 2023 W11 | Nov 17 01:15 | 2023-11-16 | 135880981/135885457 | Nov 16 16:35:13 | null |
| 2023 W12 | Nov 23 17:30 | 2023-11-16 | 135880981/135885457 | Nov 16 16:35:13 | null; **W11 absent** |
| 2023 W13 | Dec 1 01:15 | 2023-11-30 | 138246806/138253284 | Nov 30 16:33:33 | null |
| 2023 W14 | Dec 8 01:15 | 2023-11-30 | 138246806/138253284 | Nov 30 16:33:33 | null; **W13 absent** |
| 2023 W15 | Dec 15 01:15 | 2023-12-14 | 140685079/140689801 | Dec 14 16:36:35 | null |
| 2023 W16 | Dec 22 01:15 | 2023-12-21 | 141833081/141836909 | Dec 21 16:34:55 | null |
| 2023 W17 | Dec 29 01:15 | 2023-12-28 | 142784181/142787648 | Dec 28 16:36:12 | null |
| 2023 W18 | Jan 6 21:30 | 2024-01-04 | 143793456/143801333 | Jan 4 18:04:28 | null |
| 2024 W1 | Sep 6 00:20 | — | — | — | no pair |
| 2024 W2 | Sep 13 00:15 | 2024-09-12 | 192226435/192226148 | Sep 12 15:36:59 | null |
| 2024 W3 | Sep 20 00:15 | 2024-09-19 | 193631881/193631541 | Sep 19 15:39:34 | null |
| 2024 W4 | Sep 27 00:15 | 2024-09-26 | 195105644/195105522 | Sep 26 15:36:24 | null |
| 2024 W5 | Oct 4 00:15 | 2024-10-03 | 196673746/196673626 | Oct 3 15:38:11 | null |
| 2024 W6 | Oct 11 00:15 | 2024-10-03 | 196673746/196673626 | Oct 3 15:38:11 | null; **W5 absent** |
| 2024 W7 | Oct 18 00:15 | 2024-10-17 | 199788763/199788465 | Oct 17 15:38:12 | null |
| 2024 W8 | Oct 25 00:15 | 2024-10-24 | 201475964/201475693 | Oct 24 15:35:55 | null |
| 2024 W9 | Nov 1 00:15 | 2024-10-24 | 201475964/201475693 | Oct 24 15:35:55 | null; **W8 absent** |
| 2024 W10 | Nov 8 01:15 | 2024-11-07 | 204840835/204830922 | Nov 7 17:01:03 | null |
| 2024 W11 | Nov 15 01:15 | 2024-11-14 | 206495189/206495170 | Nov 14 15:30:49 | null |
| 2024 W12 | Nov 22 01:15 | 2024-11-21 | 208108160/208108087 | Nov 21 15:31:58 | null |
| 2024 W13 | Nov 28 17:30 | 2024-11-28 | 209687337/209687271 | Nov 28 15:31:18 | null |
| 2024 W14 | Dec 6 01:15 | 2024-12-05 | 211318969/211318715 | Dec 5 15:32:54 | null |
| 2024 W15 | Dec 13 01:15 | 2024-12-12 | 212918229/212913717 | Dec 12 16:00:42 | null |
| 2024 W16 | Dec 20 01:15 | 2024-12-12 | 212918229/212913717 | Dec 12 16:00:42 | null; **W15 absent** |
| 2024 W17 | Dec 25 18:00 | 2024-12-12 | 212918229/212913717 | Dec 12 16:00:42 | null; **W15–16 absent** |
| 2024 W18 | Jan 4 21:30 | 2024-12-26 | 215989292/215989303 | Dec 26 15:28:14 | null; **some W17 games not yet played** |

For 2022–2024, these are **metadata timing candidates**, not verified historical bytes: all selected paired asset API digests are null. The sampled 2022 Oct 20 weekly file has 1,850 rows through W6; the sampled 2023 Sep 14 file has 313 W1 rows; the sampled 2024 Sep 12 file has 310 W1 rows. They lack `game_id` and require a validated matchup join. Except for these samples, per-cutoff player/PBP row and identity coverage is **unverified**; do not infer it from filenames or today's downloads. A present-day SHA-256 would identify present bytes but would not attest their original publication contents. **None of 2021–2024 can support the configured strict as-published walk-forward fitting/calibration/evaluation on current evidence.**

### 2025: byte-verified pairs, including one unusable PBP asset

All **32 distinct assets** in the 16 selected release pairs were downloaded (about 103 MB). Every downloaded SHA-256 matches the API digest. The following row checks were performed on the *actual downloaded data*, not today's file filtered to old dates. Regular-season game counts in both columns are against the archived schedule's full prior-week games. For 2025 weekly files, which **lack `game_id` at these cutoffs**, the player-stat game count is inferred from both teams having season/week/team/opponent rows matching one schedule matchup; this is a coverage proxy, not a complete per-player identity or metric reconciliation. Each non-HTML PBP file has game IDs.

| Cutoff | First kickoff UTC | Release / exact weekly/PBP asset IDs | Effective UTC | Weekly / PBP rows | Prior regular-season games in weekly / PBP | Verdict |
|---|---|---|---|---|---|---|
| W1 | Sep 5 00:20 | — | — | — | — | No same-season pair; prior-season baseline not audited |
| W2 | Sep 12 00:15 | 2025-09-11 `292189578/292189172` | Sep 11 15:42:27 | 1,071 / 2,738 | 16/16 / 16/16 | timing + bytes + game rows |
| W3 | Sep 19 00:15 | 2025-09-18 `294694204/294695776` | Sep 18 15:37:20 | 2,179 / 5,527 | 32/32 / 32/32 | timing + bytes + game rows |
| W4 | Sep 26 00:15 | 2025-09-25 `297218461/297212721` | Sep 25 16:21:26 | 3,282 / 8,273 | 48/48 / 48/48 | timing + bytes + game rows |
| W5 | Oct 3 00:15 | 2025-10-02 `299769379/299770475` | Oct 2 15:33:20 | 4,389 / 11,034 | 64/64 / 64/64 | timing + bytes + game rows |
| W6 | Oct 10 00:15 | 2025-10-09 `302374474/302374075` | Oct 9 15:46:21 | 5,350 / 13,488 | 78/78 / 78/78 | timing + bytes + game rows |
| W7 | Oct 17 00:15 | 2025-10-16 `305094328/305097630` | Oct 16 15:42:35 | 6,364 / 16,011 | 93/93 / 93/93 | timing + bytes + game rows |
| W8 | Oct 24 00:15 | 2025-10-23 `307811999/307813872` | Oct 23 15:36:48 | 7,399 / 18,625 | 108/108 / 108/108 | timing + bytes + game rows |
| W9 | Oct 31 00:15 | 2025-10-30 `310571066/310572709` | Oct 30 15:39:36 | 8,291 / 20,767 | 121/121 / 121/121 | timing + bytes + game rows |
| W10 | Nov 7 01:15 | 2025-11-06 `313355171/313356862` | Nov 6 15:40:00 | 9,239 / 23,152 | 135/135 / 135/135 | timing + bytes + game rows |
| W11 | Nov 14 01:15 | 2025-11-13 `316009607/316011371` | Nov 13 15:38:04 | 10,202 / 25,552 | 149/149 / 149/149 | timing + bytes + game rows |
| W12 | Nov 21 01:15 | 2025-11-20 `318837729/318839645` | Nov 20 15:38:58 | 11,234 / 28,127 | 164/164 / 164/164 | timing + bytes + game rows |
| W13 | Nov 27 18:00 | 2025-11-27 `321531086/321532841` | Nov 27 15:37:31 | 12,201 / 30,572 | 178/178 / 178/178 | timing + bytes + game rows |
| W14 | Dec 5 01:15 | 2025-12-04 `324362524/324364390` | Dec 4 15:42:12 | 13,282 / 33,292 | 194/194 / 194/194 | timing + bytes + game rows |
| W15 | Dec 12 01:15 | 2025-12-11 `327434033/327435650` | Dec 11 15:44:21 | 14,256 / **not RDS** | 208/208 / **unavailable** | **fail: PBP asset is HTML** |
| W16 | Dec 19 01:15 | 2025-12-11 `327434033/327435650` | Dec 11 15:44:21 | 14,256 / **not RDS** | 208/224 / **unavailable** | **fail: HTML PBP; Week 15 missing** |
| W17 | Dec 25 18:00 | 2025-12-25 `332862184/332863213` | Dec 25 15:37:03 | 16,409 / 41,152 | 240/240 / 240/240 | timing + bytes + game rows |
| W18 | Jan 3 21:30 | 2026-01-01 `335211700/335212696` | Jan 1 15:37:18 | 17,472 / 43,816 | 256/256 / 256/256 | timing + bytes + game rows |

The December 11 file named `play_by_play_2025.rds` (`327435650`, **54,894 bytes**) begins `<!DOCTYPE html>` and is a GitHub HTML document, not an RDS object. Its SHA-256 `3590bcb90a75c32ba8b10d692d26838caedbc267a57db23931694abc9598c873` **matches the GitHub API digest**. A matching hash proves byte identity, not that the bytes have the advertised type or contain PBP. Do not use it for W15 or W16 or silently splice in a later corrected release. For the remaining 15 timestamped weeks, full player/game identity, per-player label and feature-fact reconciliation, and historical team/roster/availability evidence still need checks; they are **not** automatically accepted as a strict evaluation cohort.

The full 2025 integrity identities are listed here as `asset ID: GitHub SHA-256`, weekly then PBP (all compared independently to downloaded bytes):

| Release | Weekly asset / SHA-256 | PBP asset / SHA-256 |
|---|---|---|
| 2025-09-11 | `292189578`: `83f6a1f1e0dce4ff3d47ef8d7bd94227275ee5199b191b80458cced00972d648` | `292189172`: `8242d44f6fee300f16e9d2170b1c6c48dffcc2685f4ebe0620334b329ce80f04` |
| 2025-09-18 | `294694204`: `b2b63452261f20008d33bb149fe2c753f76f10c885c59fe667b7c345ff65e71e` | `294695776`: `00cc7e9d6d01477da13f14c55f63ce710a7c8b9d014177636dfed52d6ef74e54` |
| 2025-09-25 | `297218461`: `b13c1a97070c9d64a4d75e5c2bcc788781716e44b8dcef3c9e26d81c5bfec3cc` | `297212721`: `05d8d7a283917fc217c93ec6124af5fa14e443641169a6a51aa57f58e2e4185f` |
| 2025-10-02 | `299769379`: `0a6cd50b7a3a5448b09419cbfb47237b96dcff1a6d92f040fe8e458a68591d49` | `299770475`: `0b04ffcee75f07c5a1cec292d7b485ec3222bbbcb65f7d5866fcd81b802b9d9b` |
| 2025-10-09 | `302374474`: `d77dcc40e4276adbcedc78a92303df59b93ec53cd03210ec923ffdf8f28bdf22` | `302374075`: `14a594b86b207508b89a42755f624c241e6ceef516d859a4b6bd2c4a5a7b472c` |
| 2025-10-16 | `305094328`: `e2d1ad2050cdc083ec39d08c82204810a7eb1f093d20ea4edb52cda866259b6c` | `305097630`: `d4c020717d85af1950259a7a7d79b5db9ebca8d70701c2fcc7a5da0d29ea9d15` |
| 2025-10-23 | `307811999`: `d283e9e6ce7a9894ec959ca505ba9416d0a1c396212e0b32f8f1719029f9d285` | `307813872`: `6d8296b5f9e02ac2a51b35a96ade7f214d3c4fc4483036820efa46e642fd800b` |
| 2025-10-30 | `310571066`: `dfbc2a66ad5e7815d47f4cca33bce65ebc3ed5a5ae5afe5ece0dd28664240a57` | `310572709`: `09d4cbb60ab73ae5329ac5776b00c41dc3b603a21a1dd001f2b8ad43cd48f57c` |
| 2025-11-06 | `313355171`: `210a4c69c83aed18b3c1903780bb720b517500a8bcdedbdda390c9485dd5019a` | `313356862`: `fcfd0ca94a4121a36eb2aa561f28f2d32fffd199c4844e0a3da4cde2932c9a53` |
| 2025-11-13 | `316009607`: `01459cc4a0a4795506fe2a08b126c3c00f7ddf687a3d40a1599924c27cd2b2fb` | `316011371`: `bdb4fba0965dfacc093c4f71e12ebc2dc180baf63b96e5f8a889e3f844d5adec` |
| 2025-11-20 | `318837729`: `761e8e3d18833a26d09189fc477cd231cc7935af623fa3f36fda62df55860eb5` | `318839645`: `421313e98803fec97d321b6a289a4645a38246871ee12b957197e54e3eac28ae` |
| 2025-11-27 | `321531086`: `6ba630794de264fb9076f5a9c4b1b773d5a9ce47bbeeb5ab52b0fef022c77040` | `321532841`: `7aa6d2e9d52e22101e988c6fe56aa2c19c87937ffc728e6e8bbaebeb81f77482` |
| 2025-12-04 | `324362524`: `3675a1c54adb69d82f9c42bdfa03b9196c2f824a4a50ce2a8dfb845fb7fcc424` | `324364390`: `a23a110d335ef5361e70166976cca8f13392b97dcf98dfe783e4066c1df224bd` |
| 2025-12-11 | `327434033`: `b14711d32be3457188d1e6f238f54bc98b71ebddf2675cca186fbff0cbfc50a1` | `327435650`: `3590bcb90a75c32ba8b10d692d26838caedbc267a57db23931694abc9598c873` (**HTML**) |
| 2025-12-25 | `332862184`: `1eab5a3c30a7a88ba99f848da6200bef818b7bdfc4740813306bb73c4dd89dfb` | `332863213`: `fd8b789271b0dd3f3e5e4a2ec9ae3a680b7b2387b715d9796f494c8da06b3867` |
| 2026-01-01 | `335211700`: `60893fcc78830090448a99f7fa432d147944e8629a8d0554fbe429f2cc208238` | `335212696`: `e912cd312aca03724079fe1d13a7efe5e2d335b27b1000cbc486623c2aeadfd5` |

## Decision: no refit, no probabilities

The configured train/calibrate/evaluate timeline cannot pass a strict as-published audit: 2021 lacks a saved contemporary source, 2022–2024 selected assets have no independent historical digest and incomplete row validation, and the 2025 pair used at W15–16 includes non-PBP HTML. The 2025 samples alone cannot repair the 2021–2024 fit or 2024 calibration. Derived team EPA/red-zone evidence, each historical roster/team assignment and original schedule revisions are not bound to those releases. **Verification after syncing with main and the user-authorized consumer-route repair:** `pnpm --filter @workspace/api-spec run codegen`, `pnpm --filter @workspace/api-server run typecheck`, and the focused consumer-matchups/route tests all pass. The merged main tree initially had a saved-game `try` without `catch` and unrelated handlers mixed together; those routes were repaired before rechecking. No TD model or forecast endpoint was changed in this follow-up. **Do not refit current mutable imports and describe the result as a genuine held-out as-published evaluation.** There are no defensible new Brier/log-loss/calibration-by-week/position scores to report; the previous 8,139-example result remains explicitly retrospective.

The strongest supported **descriptive** view uses completed, schedule-reconciled, source-covered games: group observed QB/RB/WR/TE rushing/receiving TDs, carries and targets by the *opposing team defense* and actual offensive position, using distinct covered defensive **games** as denominators. In the verified Sep 24, 2026 snapshot, 32/32 Weeks 1–2 games reconcile to Gridline and PBP; totals include 56 rushing and 101 receiving TD scorer events. Among the covered position-labeled player appearances, the observed scoring-TD counts are QB **15 rushing, 0 receiving** (76 appearances), RB **39 rushing, 12 receiving** (184), WR **0 rushing, 58 receiving** (303), TE **2 rushing, 30 receiving** (153). These are observed touchdown **events**, not distinct scorers or modeled probabilities; do not count the QB's 101 passing TDs as anytime scoring TDs. A WR1-versus-other-WR split may be described only if the WR1 role is defined using prior covered games at the relevant cutoff; it is a **team-defense versus receiver-role** proxy, never named WR–CB coverage. Do not turn observed rates or historical simulations into live probabilities or betting lines. Uncovered games and source facts remain unavailable, not zero.

**Operational boundary:** no database writes, production bindings, publication, unrelated providers or TD-probability activation occurred. The user-authorized merge repair restored unrelated consumer handlers so the API compiles; it did not alter TD eligibility. Finish the feature contract/version decision, secure independently attested historical bytes and full cutoff-specific feature/label/identity audits (or transparently redesign a narrower cohort), and separately qualify live roster/injury/depth freshness before asking for a new fit or live ranking.