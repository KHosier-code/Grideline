# Anytime touchdown model (research)

Predicts the chance that a QB, RB, WR or TE scores at least one rushing or
receiving touchdown in a game. Passing TDs don't count.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./fetch_data.sh 2026                                         # public nflverse data -> ./data
.venv/bin/python build_dataset.py data td_dataset.parquet    # one row per player-game
.venv/bin/python evaluate.py td_dataset.parquet              # test on 2025 + 2026
.venv/bin/python predict_week.py td_dataset.parquet data picks.json   # next week's rankings
```

## What goes in

Everything is computed only from games played **before** the game being predicted.
Rolling windows carry over from the previous season.

| Group | Features |
|---|---|
| Usage | Targets and carries per game (last 3 and last 8), share of team targets and carries, receptions, yards |
| Red zone | Targets and carries inside the 20, 10 and 5; share of the team's red-zone and goal-line work |
| Track record | TD rate over the last 17 games, shrunk toward the position average |
| Matchup | Opponent's TDs allowed to that position (last 8, shrunk), red-zone plays allowed |
| Game context | Team and opponent Vegas implied points (from spread and total), home or away |

Model: gradient-boosted trees (scikit-learn `HistGradientBoostingClassifier`).
Before ranking, players who aren't on the active roster that week are removed.

## Results

Trained on 2020–2023, tested on 2025 and 2026 weeks 1–3 (6,925 player-games the model never saw).

| Method | Top-10 weekly hit rate | AUC | Brier |
|---|---:|---:|---:|
| Position average | 22.4% | 0.552 | 0.149 |
| Player's own TD rate | 50.0% | 0.699 | 0.139 |
| **Gridline TD model** | **59.5%** | **0.729** | **0.134** |

Calibration on the test seasons: predicted 12.3% → scored 12.1%, 27.5% → 27.4%,
37.1% → 35.6%, 44.4% → 41.4%.

What each group adds (test AUC after removing it): usage 0.719, red zone 0.729,
track record 0.730, matchup 0.730, game context 0.729. Usage matters most. The
other groups overlap heavily, so removing any one of them changes little.
In particular, opponent defense vs. position adds almost nothing once usage and
Vegas totals are known.

## Limits

- The test only includes players who actually played. For live picks, the
  injury report must remove players who are ruled out, or the rankings will
  include them.
- A high hit rate doesn't mean the picks beat sportsbook prices. Top candidates
  are usually priced as favorites. Comparing to real anytime-TD odds needs an odds
  feed that carries player props.
