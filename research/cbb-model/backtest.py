"""Walk-forward test of the college basketball ratings.

Usage: python backtest.py DATA_DIR [first_season] [last_season]

Every game is predicted from games played before its date only (ratings
refit each game day; last season's final ratings, shrunk, are the preseason
prior). Reports margin and total error, straight-up winners, and how both
change through the season. Seasons are named by the year they end (2026 =
the 2025-26 season).
"""
import sys

import numpy as np
import pandas as pd

from ratings import Params, Ratings, load_games

DATA = sys.argv[1]
FIRST = int(sys.argv[2]) if len(sys.argv) > 2 else 2021
LAST = int(sys.argv[3]) if len(sys.argv) > 3 else 2026


def run_season(season: int, prior, params: Params):
    games = load_games(DATA, season)
    teams = sorted(set(games.home) | set(games.away))
    model = Ratings(teams, prior, params)
    preds = []
    for day, today in games.groupby(games.date.dt.normalize()):
        model.fit(games[games.date < day], day)
        for g in today.itertuples():
            hp, ap, pace = model.predict(g.home, g.away, g.neutral)
            preds.append((g.game_id, hp - ap, hp + ap))
    out = games.merge(pd.DataFrame(preds, columns=["game_id", "pred_margin", "pred_total"]), on="game_id")
    model.fit(games, games.date.max() + pd.Timedelta(days=1))
    return out, model.snapshot()


def summarize(frame: pd.DataFrame, label: str):
    margin = frame.home_pts - frame.away_pts
    total = frame.home_pts + frame.away_pts
    decided = margin != 0
    winners = (np.sign(frame.pred_margin) == np.sign(margin))[decided].mean()
    return {"games": len(frame), "label": label,
            "margin_mae": (frame.pred_margin - margin).abs().mean(),
            "total_mae": (frame.pred_total - total).abs().mean(),
            "winners": winners}


def evaluate(params: Params, seasons, verbose=False):
    prior, rows = None, []
    results = []
    for season in range(min(seasons) - 1, max(seasons) + 1):
        out, prior = run_season(season, prior, params)
        if season in seasons:
            results.append(out)
            rows.append(summarize(out, str(season)))
    allg = pd.concat(results)
    if verbose:
        months = allg.assign(month=allg.date.dt.month)
        for name, part in [("November", months[months.month == 11]), ("December", months[months.month == 12]),
                           ("January-February", months[months.month.isin([1, 2])]), ("March-April", months[months.month.isin([3, 4])])]:
            rows.append(summarize(part, name))
        rows.append(summarize(allg, "all"))
        print(pd.DataFrame(rows).round(3).to_string(index=False))
    return summarize(allg, "all"), allg


if __name__ == "__main__":
    # Tune on 2021-2023 only, then report 2024-2026 with the chosen settings.
    tune = list(range(FIRST, FIRST + 3))
    best = None
    for half_life in (30, 45, 75):
        for ridge in (3, 6, 12):
            for carry in (0.4, 0.6, 0.8):
                params = Params(half_life_days=half_life, ridge=ridge, carryover=carry)
                score = evaluate(params, tune)[0]["margin_mae"]
                print(f"half-life {half_life:>3} ridge {ridge:>2} carryover {carry}: margin MAE {score:.3f} (2021-23)", flush=True)
                if best is None or score < best[0]:
                    best = (score, params)
    print(f"\nChosen on 2021-2023: {best[1]}\n\nUntouched test seasons {FIRST + 3}-{LAST}:")
    evaluate(best[1], list(range(FIRST + 3, LAST + 1)), verbose=True)
