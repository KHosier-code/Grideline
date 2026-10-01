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
