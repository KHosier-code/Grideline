"""Does the ratings model beat the spread?

Usage: python ats.py DATA_DIR LINES_DIR

Walk-forward predictions (roster prior, ridge 5, as chosen on 2021-2023)
for the untouched 2024-2026 seasons, against the ESPN line for each game.
The model "bets" the side its margin favors versus the spread. 52.4% wins
is break-even at -110. Also reports how close the line and the model each
came to the final margin, and win rates by size of disagreement.
"""
import glob
import sys
from dataclasses import replace

import numpy as np
import pandas as pd

import backtest_roster as br

LINES = sys.argv[2]
SEASONS = [int(s) for s in sys.argv[3].split(",")] if len(sys.argv) > 3 else [2023, 2026]

lines = pd.concat([pd.read_csv(path, dtype={"game_id": str}) for path in glob.glob(f"{LINES}/lines_*.csv")])
# Prefer the closing number; fall back to the single line ESPN shows.
lines["home_spread"] = lines.home_spread_close.fillna(lines.spread)
lines["total_line"] = lines.total_close.fillna(lines.over_under)
lines = lines.dropna(subset=["home_spread"])

preds = br.run(SEASONS, replace(br.BASE, ridge=5), True)
preds["game_id"] = preds.game_id.astype(str)
df = preds.merge(lines[["game_id", "home_spread", "home_spread_open", "total_line", "details"]], on="game_id")
print(f"{len(df):,} of {len(preds):,} test games have a line\n")

margin = df.home_pts - df.away_pts
total = df.home_pts + df.away_pts
print(f"average miss on margin: line {(-df.home_spread - margin).abs().mean():.2f}, model {(df.pred_margin - margin).abs().mean():.2f}")
tot = df.dropna(subset=["total_line"])
print(f"average miss on total:  line {(tot.total_line - (tot.home_pts + tot.away_pts)).abs().mean():.2f}, "
      f"model {(tot.pred_total - (tot.home_pts + tot.away_pts)).abs().mean():.2f}\n")

# Spread: home covers when margin + spread > 0.
edge = df.pred_margin + df.home_spread
result = margin + df.home_spread
graded = df.assign(edge=edge.abs(), win=np.sign(edge) == np.sign(result), push=result == 0)
graded = graded[~graded.push & (edge != 0)]


def show(frame, label):
    n = len(frame)
    if n:
        print(f"{label:28}{n:>7,}{frame.win.mean():>9.1%}")


print(f"{'spread picks':28}{'games':>7}{'win %':>9}")
show(graded, "all")
for lo, hi in [(0, 2), (2, 4), (4, 6), (6, 99)]:
    show(graded[(graded.edge >= lo) & (graded.edge < hi)], f"disagree {lo}-{hi if hi < 99 else '+'} pts")
for season in SEASONS:
    show(graded[graded.season == season], f"season {season}")
for name, months in [("November", [11]), ("December", [12]), ("Jan-Feb", [1, 2]), ("March-April", [3, 4])]:
    show(graded[graded.date.dt.month.isin(months)], name)
show(graded[(graded.edge >= 4) & (graded.home_spread.abs() >= 10)], "disagree 4+, big spreads")

# Totals.
t = tot.assign(edge=tot.pred_total - tot.total_line, res=total.loc[tot.index] - tot.total_line)
t = t[(t.res != 0) & (t.edge != 0)].assign(win=lambda f: np.sign(f.edge) == np.sign(f.res))
print(f"\n{'total picks':28}{'games':>7}{'win %':>9}")
show(t, "all")
for lo, hi in [(0, 3), (3, 6), (6, 99)]:
    show(t[(t.edge.abs() >= lo) & (t.edge.abs() < hi)], f"disagree {lo}-{hi if hi < 99 else '+'} pts")

# Opening lines (2025-26 has both open and close): win rate against the
# number you could bet early, and whether the line then moved toward the
# model (closing line value, in points; positive = moved our way).
o = df.dropna(subset=["home_spread_open"])
o_edge = o.pred_margin + o.home_spread_open
o_res = (o.home_pts - o.away_pts) + o.home_spread_open
o = o.assign(edge=o_edge.abs(), win=np.sign(o_edge) == np.sign(o_res),
             clv=np.sign(o_edge) * (o.home_spread_open - o.home_spread))[(o_res != 0) & (o_edge != 0)]
print(f"\n{'vs opening line':28}{'games':>7}{'win %':>9}{'line move':>11}")
for lo, hi in [(0, 99), (0, 2), (2, 4), (4, 6), (6, 99)]:
    part = o[(o.edge >= lo) & (o.edge < hi)]
    if len(part):
        label = "all" if (lo, hi) == (0, 99) else f"disagree {lo}-{hi if hi < 99 else '+'} pts"
        print(f"{label:28}{len(part):>7,}{part.win.mean():>9.1%}{part.clv.mean():>+11.2f}")
