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

Results are written up in this file once the runs finish.
