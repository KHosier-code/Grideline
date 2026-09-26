# Chart evidence check — September 26, 2026

Read-only verification only; no provider import, derivation, production query, or publish was performed.

| Evidence | 2026 Week 1 | Week 2 | Week 3 |
| --- | ---: | ---: | ---: |
| Public nflverse PBP regular-season game IDs (fresh stream read) | 16 | 16 | 1 |
| Development final schedule games | 16 | 16 | 0 |
| Development normalized team-game rows | 32 (16 games) | 32 (16 games) | 2 (1 game) |
| Development non-null offensive / defensive EPA axes | 32 / 32 | 32 / 32 | 2 / 2 |
| Development red-zone derived team facts | 96 (16 games) | 96 (16 games) | 0 |

Development's 2026 PBP ledger reported a successful 5,662-row import at 2026-09-26 01:33 UTC. The public stream had 2,756 Week 1 plays, 2,733 Week 2 plays and 173 Week 3 plays. These checks establish game/row coverage, not manual play-by-play validation of every metric. Week 3 is not a final game and must not contribute to current charts. The chart API recomputes coverage from the persisted schedule and rows at request time; this report is not an ongoing completeness guarantee.

Team-game EPA is already a per-play rate in persisted nflverse-derived rows. The league scatter uses an **unweighted arithmetic mean of eligible game rates**, with independent non-null game counts per axis; it does not use offensive plays as a denominator for defensive EPA. Trends use individual game rates. Null is missing evidence, never zero.

Game Detail matchup metrics use season-to-date versioned pregame features strictly before kickoff with at least three valid prior games per side. Offensive red-zone rate is supported there; defensive red-zone rate is not. Model performance must use official pregame predictions joined to persisted grades and final games; winner accuracy, margin MAE and total MAE are grading measures, not betting returns. A verified independent opening/closing paired prediction series is not present in the consumer contract, so no such comparison is plotted.

A read-only development join of official snapshots, grades, pre-kickoff timestamps, and final games returned no grouped season rows. The graded cumulative and season charts therefore show an unavailable state until official graded evidence exists; no results are seeded or fabricated.

The development schedule currently has no games for 2021–2024 and only six for 2025, despite hundreds of historical team-game stat rows in each season. Those rows cannot be tied to a final schedule game with verified home/away identity, so historical team chart selections must disclose excluded rows and show unavailable or partial coverage rather than presenting their rates as verified final-game observations.