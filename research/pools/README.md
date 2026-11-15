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

## Results (Nov 15, 2026, after review)

177 bowls, 2022–2025:
- confidence pools are played against Bowl Mania's confidence-format crowd
  (format 2)
- straight pools against its straight-up crowd (format 1)
- format 3 is against the spread and isn't used
- 1,500 simulations to tune each sheet and 4,000 fresh ones to score it

Each figure is the chance of finishing first:
- **Lines:** outcomes drawn from the betting lines, averaged over the four
  seasons.
- **Real:** the actual results, averaged over the four seasons, each with
  many draws of who else was in the pool.
- **Better/worse:** how many of the four real seasons the tuned sheet beat
  chalk, or lost to it, by more than 1 point.

The five opponent assumptions:
- **A, average.** Every opponent picks like the average Bowl Mania player
  and orders confidence points with moderate noise.
- **B, styles.** As A, but each opponent leans toward favorites or toward
  upsets (`--style 1`).
- **C, styles and sensible points.** As B, but opponents order their points
  more sensibly (`--noise 0.5`).
- **D, random points.** Opponents order their points very randomly
  (`--noise 2`).
- **E, tough.** As C, plus a fifth of opponents follow the betting favorites
  (`--sharp 0.2`).

**Confidence pools**

| Opponents | Pool | Fair | Chalk (lines) | Tuned (lines) | Chalk (real) | Tuned (real) | Better/worse |
|---|---|---|---|---|---|---|---|
| A, average | 25 | 3.8% | 31.8% | 32.0% | 41.7% | 41.2% | 2/1 |
| A, average | 100 | 1.0% | 16.2% | 17.1% | 16.1% | 28.0% | 2/1 |
| B, styles | 25 | 3.8% | 30.4% | 30.7% | 42.7% | 40.7% | 1/2 |
| B, styles | 100 | 1.0% | 14.2% | 16.0% | 17.9% | 44.3% | 2/0 |
| C, styles + sensible points | 25 | 3.8% | 33.6% | 33.6% | 45.4% | 46.9% | 2/1 |
| C, styles + sensible points | 100 | 1.0% | 18.2% | 19.9% | 26.4% | 26.8% | 1/1 |
| D, random points | 25 | 3.8% | 30.9% | 30.9% | 37.2% | 40.0% | 2/1 |
| D, random points | 100 | 1.0% | 13.7% | 14.6% | 8.0% | 24.6% | 2/1 |
| E, tough | 25 | 3.8% | 14.1% | 16.3% | 24.4% | 34.2% | 2/1 |
| E, tough | 100 | 1.0% | 1.7% | 5.2% | 3.2% | 25.5% | 2/0 |

**Straight-pick pools.** How opponents order points doesn't matter here, so
C matches B and D matches A.

| Opponents | Pool | Fair | Chalk (lines) | Tuned (lines) | Chalk (real) | Tuned (real) | Better/worse |
|---|---|---|---|---|---|---|---|
| A, average | 25 | 3.8% | 26.3% | 26.4% | 2.3% | 15.1% | 1/0 |
| A, average | 100 | 1.0% | 13.1% | 13.5% | 0.0% | 0.3% | 1/0 |
| B, styles | 25 | 3.8% | 17.9% | 19.9% | 2.2% | 47.3% | 3/0 |
| B, styles | 100 | 1.0% | 4.4% | 8.0% | 0.0% | 0.3% | 1/0 |
| E, tough | 25 | 3.8% | 8.5% | 14.6% | 0.8% | 21.0% | 3/0 |
| E, tough | 100 | 1.0% | 0.5% | 5.8% | 0.0% | 6.5% | 1/0 |

What this says:
- **Confidence pools: betting-favorite picks, ranked by win chance, are most
  of the edge.** That sheet won a 25-person pool 14–34% of the time in every
  scenario, against a fair 3.8%. The crowd backed the betting underdog in 44
  of 177 bowls and spread points poorly.
- **Tuning matters in big or sharp pools, and in straight pools.** In the
  tough 100-person confidence pool it roughly triples the chance, from 1.7%
  to 5.2%. In straight pools, chalk ties too many people.
- **The tuned sheet lost to chalk by more than a point in only 5 of 60 real
  season comparisons.** It beat chalk in 31.
- **The lines are trustworthy.** A calibration fit gives k = 0.94 ± 0.22,
  where 1.0 is perfect. Shrinking toward 50% made held-out seasons slightly
  worse, so the lines are used as they are. Bowl Mania's crowd adds nothing
  to the line: its coefficient is -0.16 ± 0.15 when added to the line.

What it doesn't:
- **Opponents' confidence-point habits and styles are assumed.** That's why
  there are five scenarios.
- **The "real" columns rest on four seasons, so they swing hard.** For
  example, the tuned straight sheet's 47% average comes mostly from one
  season. Read them as direction, not size.
- **Lines are as ESPN attached them to each game, not closing lines.**
