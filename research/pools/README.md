# Pool tools research

Can a pick sheet built from betting odds, and from what other players
actually pick, win office pools more often than its fair share?

## Bowl pools

- `fetch_bowlmania.py`: downloads past ESPN Bowl Mania seasons (2022–2025).
  For each bowl it saves both teams' moneylines, the share of Bowl Mania
  players who picked each team, and the winner. ESPN's data is not committed;
  run the script to get it.
- `bowl_backtest.py`: simulates pools of 10 to 100 people who pick the way
  Bowl Mania players did. It then compares two sheets, in confidence-point and
  straight-pick pools:
  - the pick-every-favorite sheet ("chalk")
  - a sheet tuned to finish first

  Each sheet is scored twice: on outcomes drawn from the betting lines, and on
  the real results.
  `--sharp 0.2` makes a fifth of the opponents follow the betting favorites.

```
python fetch_bowlmania.py bowlmania.json
python bowl_backtest.py bowlmania.json --pools 10,25,100 --sharp 0.2
```

## Results (Nov 15, 2026)

177 bowls, 2022–2025. Run with 1,500 tuning simulations and 5,000 scoring
simulations per season and pool size. Each figure is the chance of finishing
first, averaged over the four seasons:
- **Lines:** outcomes drawn from the betting lines.
- **Real:** the actual results, with many random draws of who else was in the
  pool.

A random entry's fair share is 1 in (pool size + 1).

**Opponents all pick like Bowl Mania players**

| Scoring | Pool | Fair | Chalk (lines) | Tuned (lines) | Chalk (real) | Tuned (real) |
|---|---|---|---|---|---|---|
| Confidence | 10 | 9.1% | 55.5% | 54.1% | 66.7% | 60.0% |
| Confidence | 25 | 3.8% | 42.6% | 41.8% | 51.2% | 49.2% |
| Confidence | 100 | 1.0% | 25.5% | 26.0% | 27.7% | 40.3% |
| Straight | 10 | 9.1% | 40.5% | 40.2% | 17.8% | 10.0% |
| Straight | 25 | 3.8% | 27.1% | 27.6% | 3.1% | 21.6% |
| Straight | 100 | 1.0% | 13.6% | 14.0% | 0.0% | 9.0% |

**A fifth of opponents follow the betting favorites (`--sharp 0.2`)**

| Scoring | Pool | Fair | Chalk (lines) | Tuned (lines) | Chalk (real) | Tuned (real) |
|---|---|---|---|---|---|---|
| Confidence | 10 | 9.1% | 41.3% | 40.4% | 56.0% | 56.3% |
| Confidence | 25 | 3.8% | 22.1% | 22.7% | 35.6% | 36.3% |
| Confidence | 100 | 1.0% | 4.9% | 7.6% | 9.5% | 23.4% |
| Straight | 10 | 9.1% | 28.9% | 28.9% | 12.7% | 16.8% |
| Straight | 25 | 3.8% | 12.7% | 16.8% | 1.3% | 10.6% |
| Straight | 100 | 1.0% | 1.8% | 6.7% | 0.0% | 23.7% |

What this says, and doesn't:
- **Confidence pools: chalk is the edge.** Most of the edge comes from picking
  the betting favorite and ranking points by win chance. Bowl Mania players
  backed the betting underdog in 44 of 177 bowls. Tuning only helps in big
  pools.
- **Straight-pick pools: chalk ties too often.** In the real seasons it almost
  never finished first alone. A few well-chosen upsets did better, but those
  "real" numbers rest on single seasons. For example, 95% in the 2025
  100-person pool and 0% in two others.
- **How opponents spread confidence points is assumed, not measured.** The
  model has them put more points on picks the crowd agrees with, plus noise.
  If real players rank more sensibly, the confidence-pool numbers above are
  too high.
- **Ties are scored roughly.** A tie with the best rival counts as half a win,
  however many rivals tie.
- **The lines are those ESPN attached to each game, not closing lines.**
  Favorites won 61% of bowls against the 65% the lines implied.
