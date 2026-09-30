"""Two follow-up tests of the QB-adjusted rating (September 30, 2026).

1. Line movement: does the rating's disagreement with the opening line predict
   which way the line moves by kickoff? If it does, the edge is in betting
   early, and closing line value on the site should show it.
2. High-wind totals: does the totals model beat the closing total in windy
   outdoor games, a known soft spot, even though it doesn't overall?

Walk-forward like evaluate_games.py: each season is predicted by models fit on
earlier seasons only (from 2020).

Usage: followups.py <games.parquet> <nfelo_games.csv> [followups.json]
Opening lines come from the public nfelo project output
(github.com/greerreNFL/nfelo, output_data/nfelo_games.csv). That repository
has no license, so the file is read from disk and never committed here.
"""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
          "rest_diff", "hfa", "div_game"]
TOTAL = ["pace_sum", "home_off_epa", "away_off_epa", "home_def_epa", "away_def_epa", "home_qb_value",
         "away_qb_value", "dome", "wind", "temp"]
WINDY = 15  # mph, outdoor games only

games = pd.read_parquet(sys.argv[1])
games = games[games.played & games.spread_line.notna() & (games.season >= 2020)].copy()
games["hfa"] = 1 - games.neutral
nfelo = pd.read_csv(sys.argv[2])[["game_id", "home_line_open", "home_line_close", "total_line_open", "total_line_close"]]
df = games.merge(nfelo, on="game_id", how="left")

rows = []
for season in sorted(df.season.unique()):
    if season == 2020:
        continue
    train = df[(df.season < season)].dropna(subset=RATING + TOTAL)
    test = df[df.season == season].dropna(subset=RATING + TOTAL).copy()
    rating = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(train[RATING], train.margin)
    totals = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(train[TOTAL], train.total)
    test["margin_pred"] = rating.predict(test[RATING])
    test["total_pred"] = totals.predict(test[TOTAL])
    rows.append(test)
pred = pd.concat(rows)


def wilson(wins, n, z=1.96):
    if n == 0:
        return [None, None]
    p = wins / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [round(centre - half, 3), round(centre + half, 3)]


# 1. Line movement. Market margin = -home line. Positive disagreement = rating likes home more than the opener.
move = pred.dropna(subset=["home_line_open", "home_line_close"]).copy()
move["disagree"] = move.margin_pred + move.home_line_open
move["home_move"] = move.home_line_open - move.home_line_close  # + = line moved toward home
# The rating knows each game's starting QB, which the opener may not have known.
# Games with no QB change on either side isolate the rating's own read.
move["qb_news"] = (move.home_qb_new.astype(bool) | move.away_qb_new.astype(bool)
                   | move.home_qb_out_id.notna() | move.away_qb_out_id.notna())


def movement_rows(frame):
    rows = []
    for threshold in [0.5, 1, 2, 3]:
        sub = frame[frame.disagree.abs() >= threshold]
        toward = int(((np.sign(sub.disagree) * sub.home_move) > 0).sum())
        away = int(((np.sign(sub.disagree) * sub.home_move) < 0).sum())
        rows.append({
            "threshold": threshold, "games": int(len(sub)), "towardGridline": toward, "awayFromGridline": away,
            "unchanged": int(len(sub) - toward - away),
            "towardRate": round(toward / (toward + away), 3) if toward + away else None,
            "towardRateCI": wilson(toward, toward + away),
            "averageMoveTowardGridline": round(float((np.sign(sub.disagree) * sub.home_move).mean()), 3),
        })
    return rows


steady = move[~move.qb_news]
movement = {
    "games": int(len(move)), "correlation": round(float(move.disagree.corr(move.home_move)), 3),
    "byThreshold": movement_rows(move),
    "noQbChange": {"games": int(len(steady)), "correlation": round(float(steady.disagree.corr(steady.home_move)), 3),
                   "byThreshold": movement_rows(steady)},
}

# 2. Totals by wind. Grade the model's side of the closing total; exactly on the line is no bet.
tot = pred.dropna(subset=["total_line"]).copy()
tot["edge"] = tot.total_pred - tot.total_line
tot["result"] = np.sign(np.sign(tot.edge) * (tot.total - tot.total_line))


def totals_record(sub):
    bets = sub[sub.edge != 0]
    wins, losses = int((bets.result == 1).sum()), int((bets.result == -1).sum())
    under_wins = int((sub.total < sub.total_line).sum()); under_losses = int((sub.total > sub.total_line).sum())
    return {
        "games": int(len(sub)), "model": [wins, losses, int((bets.result == 0).sum())],
        "modelRate": round(wins / (wins + losses), 3) if wins + losses else None, "modelRateCI": wilson(wins, wins + losses),
        "alwaysUnder": [under_wins, under_losses],
        "alwaysUnderRate": round(under_wins / (under_wins + under_losses), 3) if under_wins + under_losses else None,
        "modelMiss": round(float((sub.total_pred - sub.total).abs().mean()), 2),
        "lineMiss": round(float((sub.total_line - sub.total).abs().mean()), 2),
    }


outdoor = tot[tot.dome == 0]
windTotals = {
    "all": totals_record(tot),
    "outdoorCalm": totals_record(outdoor[outdoor.wind < WINDY]),
    f"outdoorWind{WINDY}Plus": totals_record(outdoor[outdoor.wind >= WINDY]),
}

out = {"testedSeasons": f"{int(pred.season.min())}–{int(pred.season.max())}", "lineMovement": movement, "windTotals": windTotals}
print(json.dumps(out, indent=1))
if len(sys.argv) > 3:
    with open(sys.argv[3], "w") as handle:
        json.dump(out, handle, indent=1)
