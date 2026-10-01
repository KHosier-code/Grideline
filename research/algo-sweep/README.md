# Algorithm sweep: 201 game-prediction variants (October 1, 2026)

`sweep.py` backtests 201 candidate algorithms on the 2023-2025 NFL seasons plus
the 2026 games played so far; `report.py` builds the results page and the
robustness tables. Every prediction uses only games before kickoff, and anything
fitted is fitted on 2020 through the previous season.

Selection and holdout are separate: algorithms are ranked on 2023-2024 only and
2025 is the untouched test. A sign-flip test (every game's cover outcome flipped
at once, 4,000 times) gives the win rate the best of all 201 reaches with no
skill, so a lucky variant is not mistaken for a good one.

Families: Elo, point-differential ratings, the EPA rating across 14 feature
builds (half-life, season carryover, QB shrinkage; `build_games.py` now reads
`HALF_LIFE_GAMES`, `SEASON_CARRYOVER` and `QB_PRIOR_DROPBACKS` from the
environment), feature subsets, regularization, other learners, home field,
rest, QB effect size, weather, blends with the opening line, market-aware
models, ensembles, shrinkage and 29 classic betting rules.

```bash
bash ../td-model/fetch_data.sh            # nflverse data into ./data
curl -fsSL -o data/nfelo_games.csv https://raw.githubusercontent.com/greerreNFL/nfelo/main/output_data/nfelo_games.csv  # not committed (no license)
for hl in 3 6 10 16; do for c in 0.25 0.5 0.75; do
  HALF_LIFE_GAMES=$hl SEASON_CARRYOVER=$c python ../game-model/build_games.py data builds/hl${hl}_c${c}_qb150.parquet; done; done
QB_PRIOR_DROPBACKS=50  python ../game-model/build_games.py data builds/hl6_c0.5_qb50.parquet
QB_PRIOR_DROPBACKS=400 python ../game-model/build_games.py data builds/hl6_c0.5_qb400.parquet
python sweep.py data builds out && python report.py out results.html
```

## Results

- **Against the closing spread nothing survives.** 4 of 188 algorithms with 100+
  bets cleared 52.4% in 2023-24; the best (54.1%) is below the 55.8% that the
  best of 201 typically reaches by luck. The top ten went 52.3% in 2023-24 and
  48.6% in 2025.
- **At the opening line, big disagreements held up.** When the EPA rating is 4+
  points off the opener, its side went 71-43 (62.3%) in 2023-24 and 35-15
  (70.0%) in 2025, but 1-7 in 2026 so far. Without games where a team changed
  starting QB: 59-40 (59.6%). The best rule of this kind had a 0.03 chance of
  being luck on 2023-24 alone. QB features use the actual starter, which may
  not be known at the open, so treat this as a lead to track with our own
  captured openers.
- **Winners and margins:** no model picks winners better than the Vegas
  favourite (69.0% in 2023-24). A 30/70 blend of the rating with the opener
  misses the margin by 10.00 pts (opener 10.04, close 9.84).

`out/survivors.json` has the opener-gap signal by season, with and without QB
changes. Opening lines from nfelo use OAK/LAR in game ids; `sweep.py` maps them
to LV/LA (the earlier `followups.py` missed those ~35 games a season).

## Filter search for a 60% spread rule

`filter_search.py` adds filters (gap size, underdog/favourite, home/road,
spread size, QB change, week, division) to the opener-gap rule: 3,360
combinations, graded at the opening spread over 2021 through 2026 week 3.
40 combinations with 100+ bets reach 60%. The broadest is a gap of 4+ points,
betting the underdog, spread 7 or less: 107-63 (62.9%). It had a losing 2024
(13-18) and is 1-4 in 2026.

To see how much of that is fitting, the same search run on 2021-2024 only found
90 combinations at 60%+. On 2025-2026, games they were not tuned on, the top 20
went 212-164 (56.4%). So expect roughly 55-57% going forward, not 60%+.
Results are in `out/filter_search.json`.

## Variants of the live model

`live_variants.py` runs 378 versions of the live rating (14 feature builds x 5
input sets x 3 ridge strengths x QB weight 1 or 1.5) on 2021 through 2026 week 3.
Betting every game, none reaches 60%: the best is 51.5% at the close and 53.3% at
the opener. Only betting 4+ point gaps: best 55.8% at the close; at the opener
the median variant is 56% and 2 of 378 reach exactly 60%. The 10 best variants
picked on 2021-2024 went 53.6% on 2025-2026 at the opener (4+ gaps).
Summary in `out/live_variants_summary.json`.

## Touchdown picks backtest

`td_backtest.py` re-tests the anytime-TD model walk-forward: each of 2023, 2024,
2025 and 2026 (weeks 1-3) is predicted by a model trained on 2020 through the
season before. Build the dataset with `../td-model/build_dataset.py` first.

| Weekly picks | 2023 | 2024 | 2025 | 2026 wk 1-3 | All | Break-even odds |
|---|---|---|---|---|---|---|
| Top 1 | 13/18 | 8/18 | 12/18 | 3/3 | 36/57 (63.2%) | -171 |
| Top 3 | 36/54 | 31/54 | 30/54 | 9/9 | 106/171 (62.0%) | -163 |
| Top 5 | 56/90 | 56/90 | 52/90 | 13/15 | 177/285 (62.1%) | -164 |
| Top 10 | 101/180 | 102/180 | 98/180 | 21/30 | 322/570 (56.5%) | -130 |

Probabilities are well calibrated (predicted 54% -> scored 60%; 44% -> 45%).
Hit rate is not profit: these players are priced as favourites, so a pick only
has value when the book's price is longer than the break-even odds for its
predicted chance. Historical prop prices aren't in the public data; the site
captures DraftKings/FanDuel anytime-TD prices live, which is the way to grade value.

## Venom Analytics-style picks

Kalen asked how Venom Analytics (a Whop product) runs its NFL algorithms. Their
method isn't public. What is public (search listings of venomanalytics.io, their
Whop page and X accounts; the pages themselves are blocked from our research
environment and the product is paid) describes an MLB home-run tool: a
proprietary "Venom Score" ranking every player daily, a "DUE" tag for players
whose underlying numbers run ahead of their results, a "PITCHER VULNERABLE" tag,
and weekly "NFL Touchdown Watch" posts from a co-founder. No NFL spread product
and no published win/loss record turned up; the Whop listing shows a 4.9/5
review score, which is not a betting record.

`venom_backtest.py` recreates those ideas for NFL anytime-TD picks and, since
nothing they describe is a spread model, a team-level "due for points" rule
graded against the spread. 2021 through 2026 week 3, walk-forward.

| Top 5 weekly picks | 2021-2026 wk 3 | 2023-2026 wk 3 |
|---|---|---|
| Gridline TD model (live) | 261/465 (56.1%) | 177/285 (62.1%) |
| Venom Score (equal-weight opportunity, share, implied total, opponent) | 254/465 (54.6%) | 165/285 (57.9%) |
| Player's own TD rate | 230/465 (49.5%) | 149/285 (52.3%) |
| Touchdown Watch (near misses inside the 5 last game) | 209/465 (45.0%) | 130/285 (45.6%) |
| DUE (expected TDs minus actual TDs) | 131/465 (28.2%) | 86/285 (30.2%) |
| Venom Score, DUE-tagged players only | 106/465 (22.8%) | 66/285 (23.2%) |

"Due" doesn't work in the NFL: among players with real red-zone volume, those
tagged DUE scored 85/286 (29.7%) against 37.4% for the rest, close to what our
model already expected for them (26.5%). Players who aren't scoring keep not
scoring. The Gridline TD model's 62.1% also depends on its random seed and first
training season: five seeds with 2019 or 2020 as the first season give 55.1% to
62.5% (median about 60%).

Against the spread, 12 "due offense" rules (yards per point or red-zone TD
shortfall, last 3 or 8 games, three gap sizes) went 46.7% to 52.4% at the
opener and 47.6% to 53.3% at the close. The best of 12 coin-flip rules
typically reaches 54.8%, so none shows skill. Results are in
`out/venom_backtest.json`.

### Venom's published NFL formula, rebuilt

Kalen later shared Venom's "NFL Metrics Explained" page, which gives the
anytime-TD recipe: over a player's last five meaningful games, Venom Score =
baseline x 0.60 + opportunity x 0.40 + a due bonus (+8 for an elite red-zone
role and 3 straight games without a TD, +5 for 12+ touches and 4 straight).
Baseline is red-zone share 35%, touches 25%, goal-line carries 15%, target
share 15%, TD rate 10%; opportunity is implied team total 55% and TDs the
opponent allows the position 45%. "TD debt" prices every touch at the league
rate for its zone and play type; expected minus actual TDs tags players "Due
For TD" or "Regression Risk". `venom_replica.py` rebuilds it (the docstring
lists the choices the page leaves open: percentile scaling, what counts as
meaningful, zone edges, the elite cutoff).

| Top 5 weekly picks | 2021-2026 wk 3 | 2023-2026 wk 3 |
|---|---|---|
| Venom Score, as published | 249/465 (53.5%) | 157/285 (55.1%) |
| Venom Score without the due bonus | 259/465 (55.7%) | 169/285 (59.3%) |
| Gridline TD model (seed 7) | 261/465 (56.1%) | 177/285 (62.1%) |
| Gridline TD model, five seeds | 52.9% to 56.1% | 55.1% to 62.5% |

- The due bonus is what hurts. Top-1 picks hit 45.2% with it and 55.9%
  without. Inside Venom's weekly top 10, players tagged Due For TD scored
  42.4% (330 picks) against 53.5% for the rest (600).
- TD debt adds nothing once usage is known: Due For TD players scored 24.1%
  (Gridline expected 24.4%), Regression Risk players 27.2% (expected 26.7%).
- Without the bonus the Venom formula is roughly as good as our model; the
  gap is inside the seed range. Their weekly top 5 and ours share only 30% of
  players. Our probabilities are better calibrated (Brier 0.1388 vs 0.1418).
- Team TD debt against the spread (six rules, offense alone or with the
  opposing defense's debt) went 48.0% to 52.0% at the opener and 49.4% to
  52.3% at the close: no edge.

Hit rate still isn't profit: these are favourite-priced props, so a pick only
pays when the book's price is longer than the break-even odds. Results are in
`out/venom_replica.json`.
