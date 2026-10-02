"""Walk-forward backtest of the anytime-touchdown picks, 2023 through 2026 week 3.

Each test season is predicted by models trained on 2020 through the season
before, with the same features and model as research/td-model. Picks are the
top N players by predicted chance each week. A pick "hits" if the player scores
a rushing or receiving TD. Sportsbooks void anytime-TD bets on players who
don't play, so grading only players who played matches how the bet settles.

Usage: td_backtest.py <td_dataset.parquet> <out.json>
"""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, __file__.rsplit("/", 2)[0] + "/td-model")
from features import ALL, SeedAveragedGBM  # noqa: E402

df = pd.read_parquet(sys.argv[1])
df = df[(df.prior_games >= 1) & df.implied.notna() & (df.upcoming == 0)].copy()
for p in ["QB", "RB", "WR", "TE"]:
    df[f"pos_{p}"] = (df.position == p).astype(int)

MODELS = {
    "Gridline TD model (live)": SeedAveragedGBM,
    "Single seed (7), the live model before October 2026": lambda: HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=80, l2_regularization=1.0, random_state=7),
    "Logistic regression": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                                 LogisticRegression(C=0.3, max_iter=3000)),
}
TOP_N = [1, 3, 5, 10, 20]
TEST = [2021, 2022, 2023, 2024, 2025, 2026]

preds = []
for season in TEST:
    train = df[df.season.between(2020, season - 1)]
    test = df[df.season == season].copy()
    for name, make in MODELS.items():
        test[name] = make().fit(train[ALL], train.label).predict_proba(test[ALL])[:, 1]
    test["Player's own TD rate"] = test.td_rate_shrunk.clip(0.01, 0.99)
    preds.append(test)
p = pd.concat(preds)
METHODS = list(MODELS) + ["Player's own TD rate"]


def breakeven(rate):
    """American odds at which this hit rate breaks even."""
    if rate is None or rate <= 0 or rate >= 1:
        return None
    return round(-100 * rate / (1 - rate)) if rate >= 0.5 else round(100 * (1 - rate) / rate)


out = {"seasons": TEST, "playerGames": {int(s): int((p.season == s).sum()) for s in TEST}, "methods": {}}
for method in METHODS:
    res = {}
    for n in TOP_N:
        top = p.sort_values(method, ascending=False).groupby(["season", "week"]).head(n)
        by = top.groupby("season").label.agg(["sum", "count"])
        rate = top.label.mean()
        res[f"top{n}"] = {
            "hits": int(top.label.sum()), "picks": int(len(top)), "rate": round(float(rate), 4),
            "predicted": round(float(top[method].mean()), 4),
            "bySeason": {int(s): [int(r["sum"]), int(r["count"]), round(r["sum"] / r["count"], 4)] for s, r in by.iterrows()},
            "breakEvenOdds": breakeven(rate),
            "weeksAtLeastHalf": round(float((top.groupby(["season", "week"]).label.mean() >= 0.5).mean()), 3),
        }
    out["methods"][method] = res

# Picks the live model gives 50%+ (would be priced as favourites).
main = "Gridline TD model (live)"
for cut in (0.4, 0.5, 0.6):
    sel = p[p[main] >= cut]
    out.setdefault("byPredictedChance", {})[f"{int(cut*100)}%+"] = {
        "picks": int(len(sel)), "hitRate": round(float(sel.label.mean()), 4) if len(sel) else None,
        "predicted": round(float(sel[main].mean()), 4) if len(sel) else None,
        "bySeason": {int(s): [int(g.label.sum()), int(len(g))] for s, g in sel.groupby("season")}}
bins = pd.cut(p[main], [0, .1, .2, .3, .4, .5, .6, 1])
out["calibration"] = [{"bin": str(b), "n": int(len(g)), "predicted": round(float(g[main].mean()), 4), "actual": round(float(g.label.mean()), 4)}
                      for b, g in p.groupby(bins, observed=True)]
top10 = p.sort_values(main, ascending=False).groupby(["season", "week"]).head(10)
out["top10ByPosition"] = {pos: [int(g.label.sum()), int(len(g))] for pos, g in top10.groupby("position")}
json.dump(out, open(sys.argv[2], "w"), indent=1)
for method, res in out["methods"].items():
    print(method)
    for k, v in res.items():
        print(f"  {k}: {v['hits']}/{v['picks']} = {v['rate']:.3f} (pred {v['predicted']:.3f}, break-even {v['breakEvenOdds']}) {v['bySeason']}")
print(json.dumps({k: out[k] for k in ("byPredictedChance", "calibration", "top10ByPosition")}, indent=1))
