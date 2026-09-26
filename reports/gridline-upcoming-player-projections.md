# Development-only upcoming player projections

**Calculation:** 2026-09-26T19:14:18.406Z. **Scope:** nearest future regular-season week (15 verified-kickoff games). Read-only calculation against the independently attested development database; no new provider retrieval, worker startup, database write, deployment or publish.

## Results

| Evidence / decision | Players |
|---|---:|
| Skill-position cohort in the retained full-response reconciliation | 512 |
| Unique direct Sleeper ESPN-ID matches with canonical team agreement (`WSH`/`WAS` included) | 128 |
| Additional trusted crosswalk matches with verifiable membership in **this** Sleeper response | 0 |
| Conditional-forecast eligible | **115** |
| Participation/availability uncertain among those conditional candidates | **115** |
| Forecast unavailable | **397** |

Uncertainty is **not** an extra disjoint group: all 115 eligible candidates have conditional projections **and** uncertain future participation. An injury-only response, even one recording `Active`, does not guarantee they will play. The old strict roster/starter readiness audit remains separate (0 eligible under its stricter policy) and was not retroactively relabeled. The current conditional policy accepts a complete, validated, under-48-hour Sleeper full-response player/team observation where the ESPN team agrees, without pretending it is independent ESPN roster verification or requiring complete depth coverage.

| Frozen model family | Genuine upcoming forecasts |
|---|---:|
| QB passing yards | **29** |
| RB rushing yards | **19** |
| WR/TE receiving yards | **67** |
| WR/TE receptions | **67** |
| **Total** | **182** |

Suppression counts across the 512-player cohort: **384** without a uniquely matching, same-team full-response direct identity (382 without a direct match and 2 whose Sleeper team is missing); **7** off the nearest slate or with an ambiguous game; **5** with recent reported unavailability; **1** without adequate strictly prior appearances/model inputs. These disjoint reasons total **397**. The trusted crosswalk evidence table currently has no rows. Existing mapping results tied to older change-only snapshots cannot prove a player's membership/team in the September 26 full response, so no additional players were promoted from them. No fuzzy matching.

The API returns a reason alongside each withheld candidate (or each withheld family when only that family's minimum historical input is missing); the page summarizes withheld reasons by player. These suppression counts are player-level, while the detailed withheld list contains **398** records because the one suppressed receiver candidate lacks sufficient history for both receiver markets.

## Input and inference policy

- Full-response Sleeper body received **2026-09-26T18:58:02.183Z**; the retained reconciliation, response digest, run metadata, 12,229-player/32-team coverage and source capture timestamp are checked before use. The process verifies development-only mode, the database name, role, local proxy, non-replica state, PostgreSQL system ID and database OID. If a later fetch replaces this evidence or the 48-hour window expires, the direct cohort fails closed rather than inheriting freshness from changed-row timestamps. The source body itself was not archived, so a new provider publication is not inferred.
- Unique GSIS↔ESPN identity is required in both directions; the ESPN current team and Sleeper team must agree after existing team aliases. Schedule identity and kickoff are verified. A new team conflict, ambiguous identity, explicit recent `Out`/`Inactive`/IR/suspension, stale source or inadequate sample withholds output. Injury omissions remain unknown; recent `Questionable`/`Doubtful` do not become confirmed availability.
- Target-free features reuse the exact ordered historical model schema and missing-indicator treatment. Prior player stat lines and team context are restricted to explicitly final, pre-calculation, pre-kickoff games; source row write times must precede calculation. The 2021–2024 historical date-boundary rule remains intact. No target-game outcome or future-game feature enters the vector. All four **fitted artifacts** are loaded from the unchanged frozen baseline report (SHA-256 `131c5672ce49d28b0fd226be4465d188d6403f1a5da19f88bd69e35c5ad6dc3e`), checked for feature order/configuration and applied without fitting or tuning; non-finite values are rejected.
- Each returned row contains player/team/opponent, scheduled kickoff, conditional statistic, frozen model version, prior appearances/quality, recent and season means, retrieval and calculation times, current matching injury label when fresh, missing features and explicit participation uncertainty. An `Active` label is **not** displayed as guaranteed participation. The 48-hour clock is assessed at calculation time, not claimed as a guarantee through kickoff.

## Verification and surface

Focused feature tests cover historical/upcoming parity, no target/post-cutoff leakage, frozen determinism, short histories, missing indicators and artifact mismatch (14 passing). Evidence tests cover alias-compatible direct matches, stale/future retrieval, missing/conflicting teams, missing injury data, stale `Out`, recent `Out` and recent `Inactive`, and the continued uncertainty of two recent `Active` labels (6 passing). API and web typechecks pass; a proxied development GET returned HTTP 200 and the 182 distinct market projections above. These are development calculations, **not** the historical 2024 simulations.

The Props page now shows conditional forecasts **separately** from the historical archive, with the exact label “DEVELOPMENT FORECAST — CONDITIONAL ON PARTICIPATION,” injury/sample/source context and a separately explained strict source-readiness audit. The unauthenticated browser preview displayed the site's entry page rather than Props, so the Props view was not visually verified in a signed-in session; the generated client contract and endpoint were checked directly. The production route returns explicit unavailability and cannot reach the development-only DB reader. The sportsbook placeholder remains unavailable. Phase 6.1 and the four fitted player artifacts are unchanged; production was not touched.