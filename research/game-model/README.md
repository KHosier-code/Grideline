# Game model backtest (spread, winners, totals)

Walk-forward test of the production game model configuration (Phase 6.1:
ridge regression for margin, logistic regression for winners, gradient
boosting for totals, same features). For each test season the models are
trained only on 2021 through the prior season, then graded against the
closing lines in nflverse `games.csv`. Picks and grading use the same rules
as the site (`artifacts/api-server/src/lib/pick-grading.ts`).

The Phase 6.1 pipeline and the `local-pipeline-cli.ts` / `local-backtest-cli.ts`
commands that produced these numbers have been retired; check out a commit
before their removal to reproduce them.

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

# New model: QB-adjusted power rating (September 30, 2026)

`build_games.py` builds one row per game from nflverse play-by-play and the
schedule; `evaluate_games.py` runs the walk-forward test (fit on seasons before
each test season only, graded against closing lines).

Features, all from games before kickoff:
- Starting QB value: EPA per dropback, recency-weighted, shrunk toward backup
  level (-0.08) with a 150-dropback prior; completion over expected; whether
  the starter differs from the team's usual starter over its last 4 games.
- Team offense and defense: EPA/play, success rate, pass and rush EPA,
  half-life 6 games, last season's games count half.
- Situation: home field (0 at neutral sites), rest difference, division game.
- Totals also use dome, wind and temperature.

Two versions: a power rating that never sees the line, and a market-aware
version that starts from the closing line and moves off it only as far as
the rating, QB and rest signals justify.

| Season | Margin miss: rating / market-aware / line | Winners: rating / Vegas favorite | ATS: rating | ATS: market-aware |
|---|---|---|---|---|
| 2021 | 11.07 / 10.76 / 10.67 | 62.7% / 62.3% | 49.8% | 50.2% |
| 2022 | 9.13 / 8.80 / 8.78 | 65.6% / 66.3% | 52.2% | 51.5% |
| 2023 | 10.45 / 10.01 / 9.98 | 61.4% / 67.4% | 48.7% | 53.9% |
| 2024 | 9.95 / 9.70 / 9.70 | 69.1% / 70.5% | 52.0% | 50.9% |
| 2025 | 10.12 / 9.70 / 9.67 | 63.0% / 65.8% | 46.5% | 47.9% |
| 2026 wk 1-3 | 11.41 / 10.46 / 10.41 | 56.2% / 66.7% | 37.8% | 48.9% |

Pooled 2021-2026 against the spread: rating 49.4%, market-aware 50.8%
(50.6% / 49.9% / 50.8% when only betting disagreements over 0.25 / 0.5 / 0.75
points). Over/under 49.2-49.5%. Break-even at -110 is 52.4%.

Conclusion: the new model forecasts nearly as well as the closing line and is
clearly better than the old one, but it does not beat closing lines, so the
site shows it as a projection ("Gridline line") and makes no spread or total
picks. Beating the market would need information the closing line does not
already have, for example betting earlier in the week than the close. That
needs historical opening lines to test.

# Opening lines (September 30, 2026)

Test of the same walk-forward rating against **opening** lines, with a
market-aware layer fit on earlier seasons that predicts the cover margin
against the opener. Opening lines for this test came from the public output
of the nfelo project (github.com/greerreNFL/nfelo, `output_data/nfelo_games.csv`).
That repository has no license, so the data is not copied into this repo.

| Bet only when predicted edge vs open exceeds | 2021-2025 record | Win rate |
|---|---:|---:|
| 0 pts | 624-596 | 51.1% |
| 0.5 pts | 405-370 | 52.3% |
| 1.0 pts | 243-211 | 53.5% |
| 1.5 pts | 131-112 | 53.9% |
| 2.0 pts | 70-67 | 51.1% |
| raw rating 3+ pts off the open | 232-199 | 53.8% |

Against the close the same model was 49-51%. Selective bets against the
opener clear break-even (52.4%) but the samples are small (a 95% range of
about +/-4.6 points at n=454), so this is a lead, not proof. nfelo's own
published projections, tuned on the same seasons, went 55.2% at the open and
52.1% at the close over 2021-2025, which points the same way.

Next steps to make this real: capture opening lines ourselves each week (the
site's first-line odds capture already does this when ODDS_API_KEY is set),
grade every recommendation against both the open and the close, and track
closing line value.

# Follow-ups: line movement and windy totals (September 30, 2026)

`followups.py` re-runs the walk-forward rating (each season fit only on earlier
seasons; tested on 2021 through the 2026 games played so far) and asks two questions. Results are in
`followups.json`; opening lines again come from nfelo's public output, read
from disk and not committed.

**Does the line move toward Gridline after it opens?** Yes, consistently.
When the rating disagrees with the opener, the closing line ends up closer to
Gridline's number about two times out of three:

| Rating vs opener | Games | Moved toward Gridline | Moved away | Unchanged | Toward rate (95% CI) | Avg move toward |
|---|---:|---:|---:|---:|---:|---:|
| 0.5+ pts | 1,134 | 501 | 262 | 371 | 65.7% (62–69%) | +0.48 |
| 1+ pts | 985 | 434 | 227 | 324 | 65.7% (62–69%) | +0.52 |
| 2+ pts | 711 | 336 | 152 | 223 | 68.9% (65–73%) | +0.69 |
| 3+ pts | 477 | 240 | 91 | 146 | 72.5% (68–77%) | +0.87 |

The rating knows each game's starting quarterback, which the opener may not
have. Leaving out every game where either team had a new or ruled-out starter
(799 games) the pattern holds: 64% toward at 0.5+ points, 70% at 3+. So the
rating reads games the way the market eventually does, and the value is in
getting the number early. This is the same signal the site's closing line
value card now tracks on live games.

**Windy totals.** The totals model does not beat the closing total in wind
either: 46–47 in outdoor games with 15+ mph wind (all games: 49.0%). Taking
the under in those games went 57–36 (61.3%, 95 games), but the sample is too
small to separate from luck and the wind values are recorded at kickoff, not
forecast when you'd bet. Totals picks stay off.

What changes on the site: nothing is presented as a pick. Closing line value
on Model Performance and the "where we disagree with Vegas" list on the home
page are the live test of the first result.
