# Game model backtest (spread, winners, totals)

Walk-forward test of the production game model configuration (Phase 6.1:
ridge regression for margin, logistic regression for winners, gradient
boosting for totals, same features). For each test season the models are
trained only on 2021 through the prior season, then graded against the
closing lines in nflverse `games.csv`. Picks and grading use the same rules
as the site (`artifacts/api-server/src/lib/pick-grading.ts`).

Run locally after seeding a database (see `local-seed-cli.ts` and
`local-pipeline-cli.ts`):

```bash
NODE_ENV=development DATABASE_URL=postgresql://postgres@127.0.0.1:5434/gridline?sslmode=disable \
  pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/local-backtest-cli.ts data/games.csv
```

## Results (September 30, 2026)

| Season | Games | ATS | Winners: model | Winners: Vegas favorite | Avg margin miss: model / line | O/U |
|---|---:|---:|---:|---:|---:|---:|
| 2023 | 285 | 137-136-12 (50.2%) | 64.7% | 69.9% | 10.49 / 9.93 | 49.8% |
| 2024 | 285 | 137-145-3 (48.6%) | 63.8% | 69.4% | 10.33 / 9.79 | 51.1% |
| 2025 | 285 | 145-139-1 (51.1%) | 61.8% | 68.5% | 10.20 / 9.60 | 47.0% |
| 2026 wk 1-3 | 48 | 24-22-2 (52.2%) | 51.1% | 64.4% | 11.03 / 10.59 | 39.6% |

ATS by size of disagreement with the line (points):

| Season | 0-1.5 | 1.5-3 | 3-5 | 5+ |
|---|---:|---:|---:|---:|
| 2023 | 53.9% | 51.4% | 51.7% | 40.7% |
| 2024 | 42.1% | 42.2% | 51.8% | 59.3% |
| 2025 | 50.0% | 53.5% | 43.9% | 56.9% |

## What this means

- Against the spread the model is a coin flip. Break-even at -110 is 52.4%.
  Bigger disagreements do not win more often in a consistent way.
- Picking the Vegas favorite wins 5-7 points more often than the model's
  winner picks, and the closing line misses the final margin by less.
- The totals model varies by under 1 point across games, so over/under
  "picks" only restate whether the line is above or below about 45. Over/under
  picks are turned off on the site (`TOTAL_PICKS_ENABLED` in `pick-sheet.ts`).
- 2025 winner accuracy (61.8%) matches the earlier audit in
  `reports/gridline-2025-oos-model-audit.md`, which confirms this replication.
