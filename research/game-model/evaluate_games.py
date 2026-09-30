"""Walk-forward test of the new game model against closing lines.

For each test season S, models are fit on seasons < S only (starting 2020 so
every game has prior-season history). Picks and grading follow the site's
rules: a projection exactly on the line is not a pick; pushes are counted.

Usage: evaluate_games.py <games.parquet> [results.json]
"""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

df = pd.read_parquet(sys.argv[1])
df = df[df.played & df.spread_line.notna() & (df.season >= 2020)].copy()
df["hfa"] = 1 - df.neutral

RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
          "rest_diff", "hfa", "div_game"]
TOTAL = ["pace_sum", "home_off_epa", "away_off_epa", "home_def_epa", "away_def_epa", "home_qb_value",
         "away_qb_value", "dome", "wind", "temp"]


def record(results):
    wins = int((results == 1).sum()); losses = int((results == -1).sum()); pushes = int((results == 0).sum())
    rate = wins / (wins + losses) if wins + losses else float("nan")
    return wins, losses, pushes, rate


def ats(margin_pred, frame, threshold=0.0):
    """+1 win, -1 loss, 0 push for games where |edge| > threshold; NaN otherwise."""
    cover = frame.margin.values - frame.spread_line.values       # > 0: home covered
    edge = margin_pred - frame.spread_line.values                # > 0: we like home
    out = np.full(len(frame), np.nan)
    take = np.abs(edge) > threshold
    out[take] = np.where(cover[take] == 0, 0, np.where(np.sign(cover[take]) == np.sign(edge[take]), 1, -1))
    return out[~np.isnan(out)]


def totals_record(total_pred, frame, threshold=0.0):
    over = frame.total.values - frame.total_line.values
    edge = total_pred - frame.total_line.values
    out = np.full(len(frame), np.nan)
    take = np.abs(edge) > threshold
    out[take] = np.where(over[take] == 0, 0, np.where(np.sign(over[take]) == np.sign(edge[take]), 1, -1))
    return out[~np.isnan(out)]


summary = []
pooled = {"rating": [], "market": {t: [] for t in (0, 1, 2, 3)}, "totals": {t: [] for t in (0, 1.5, 3)}}
for season in [2021, 2022, 2023, 2024, 2025, 2026]:
    train = df[df.season < season].dropna(subset=RATING)
    test = df[df.season == season].dropna(subset=RATING)
    if test.empty:
        continue
    # 1) Power rating: no market information.
    rating = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(train[RATING], train.margin)
    r_train, r_test = rating.predict(train[RATING]), rating.predict(test[RATING])
    # 2) Market-aware: predict how far the final margin lands from the line, using
    #    how far our rating is from the line plus the QB change signal. Heavily shrunk.
    def market_x(frame, r):
        return np.column_stack([r - frame.spread_line.values, frame.qb_new_edge.values, frame.qb_edge.values,
                                frame.rest_diff.values])
    residual = Ridge(alpha=200).fit(market_x(train, r_train), train.margin - train.spread_line)
    m_test = test.spread_line.values + residual.predict(market_x(test, r_test))
    # Winners: logistic on the rating, and the Vegas favorite as a benchmark.
    win = LogisticRegression(max_iter=2000).fit(r_train.reshape(-1, 1), (train.margin > 0).astype(int))
    p_home = win.predict_proba(r_test.reshape(-1, 1))[:, 1]
    decided = test.margin != 0
    model_winners = ((p_home > 0.5) == (test.margin > 0))[decided].mean()
    fav = np.where(test.spread_line != 0, test.spread_line > 0, test.home_moneyline < test.away_moneyline)
    favorite_winners = (fav == (test.margin > 0))[decided].mean()
    # Totals.
    tot_train = train.dropna(subset=TOTAL + ["total_line"]); tot_test = test.dropna(subset=TOTAL + ["total_line"])
    tot_rating = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(tot_train[TOTAL], tot_train.total)
    tot_resid = Ridge(alpha=200).fit(np.column_stack([tot_rating.predict(tot_train[TOTAL]) - tot_train.total_line]),
                                     tot_train.total - tot_train.total_line)
    t_test = tot_test.total_line.values + tot_resid.predict(np.column_stack([tot_rating.predict(tot_test[TOTAL]) - tot_test.total_line]))

    r_ats = ats(r_test, test)
    pooled["rating"].append(r_ats)
    row = {
        "season": int(season), "games": int(len(test)),
        "mae_rating": round(float(np.mean(np.abs(r_test - test.margin))), 2),
        "mae_market_aware": round(float(np.mean(np.abs(m_test - test.margin))), 2),
        "mae_line": round(float(np.mean(np.abs(test.spread_line - test.margin))), 2),
        "winners_model": round(float(model_winners), 3), "winners_favorite": round(float(favorite_winners), 3),
        "ats_rating": record(r_ats),
    }
    for threshold in (0, 1, 2, 3):
        result = ats(m_test, test, threshold * 0.25)  # market-aware edges are small by design
        pooled["market"][threshold].append(result)
        row[f"ats_market_{threshold * 0.25:g}"] = record(result)
    for threshold in (0, 1.5, 3):
        result = totals_record(t_test, tot_test, threshold * 0.25)
        pooled["totals"][threshold].append(result)
        row[f"ou_{threshold * 0.25:g}"] = record(result)
    summary.append(row)

pd.set_option("display.width", 250)
print(pd.DataFrame(summary).to_string(index=False))
print("\nPooled 2021-2026 (break-even at -110 is 52.4%):")
print("  Power rating ATS:", record(np.concatenate(pooled["rating"])))
for threshold, parts in pooled["market"].items():
    print(f"  Market-aware ATS, edge > {threshold * 0.25:g} pts:", record(np.concatenate(parts)))
for threshold, parts in pooled["totals"].items():
    print(f"  Market-aware O/U, edge > {threshold * 0.25:g} pts:", record(np.concatenate(parts)))
if len(sys.argv) > 2:
    json.dump(summary, open(sys.argv[2], "w"), indent=1, default=str)
