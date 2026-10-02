"""Variants of the live site's rating (gridline-qb-rating-v1) graded against the spread, 2021-2026.

Varies the feature build (decay half-life, last-season weight, QB shrinkage),
ridge strength, which inputs are used, and how much the QB and home-field terms
count. Each season is predicted by a fit on 2020 through the season before.

Grades four ways: every game at the closing spread and at the opener, and only
games where the variant is 4+ points off the line. Then picks the best variants
on 2021-2024 and shows how they did on 2025-2026.

Usage: live_variants.py <builds dir> <nfelo_games.csv> <out.json>
"""
import itertools
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

BUILDS, NFELO, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
          "rest_diff", "hfa", "div_game"]
FEATURES = {
    "live inputs": RATING,
    "+ wind and cold": RATING + ["wind_out", "cold"],
    "no QB terms": [f for f in RATING if not f.startswith("qb_")],
    "no rest or division": [f for f in RATING if f not in ("rest_diff", "div_game")],
    "EPA + success + QB + home only": ["epa_edge", "success_edge", "qb_edge", "qb_new_edge", "hfa"],
}
ALPHAS = [1, 10, 100]
QB_SCALES = [1.0, 1.5]
SEASONS = list(range(2021, 2027))
GAP = 4

nfelo = pd.read_csv(NFELO)[["game_id", "home_line_open"]]
nfelo["game_id"] = nfelo.game_id.str.replace(r"_(OAK|LAR|SD|STL)(?=_|$)",
                                             lambda m: "_" + {"OAK": "LV", "LAR": "LA", "SD": "LAC", "STL": "LA"}[m.group(1)], regex=True)


def load(name):
    df = pd.read_parquet(f"{BUILDS}/{name}.parquet")
    df = df[df.played & df.spread_line.notna() & (df.season >= 2020)].copy()
    df["hfa"] = 1 - df.neutral
    df["wind_out"] = np.where(df.dome == 1, 0.0, df.wind)
    df["cold"] = ((df.dome == 0) & (df.temp <= 32)).astype(int)
    df = df.merge(nfelo, on="game_id", how="left")
    df["open"] = -df.home_line_open
    return df.sort_values("game_id").reset_index(drop=True)


def predict(df, feats, alpha, qb_scale):
    out = pd.Series(np.nan, index=df.index)
    for season in SEASONS:
        train, test = df[df.season < season].dropna(subset=feats), df[df.season == season]
        model = make_pipeline(StandardScaler(), Ridge(alpha=alpha)).fit(train[feats].values, train.margin.values)
        X = test[feats].values.copy()
        pred = model.predict(X)
        if qb_scale != 1.0 and "qb_edge" in feats:
            X[:, feats.index("qb_edge")] = train.qb_edge.mean()
            pred = model.predict(X) + qb_scale * (pred - model.predict(X))
        out[test.index] = pred
    return out.values


def grade(df, pred, line_col, gap):
    line = df[line_col].values
    edge = pred - line
    res = np.sign(df.margin.values - line) * np.sign(edge)
    bet = ~np.isnan(res) & (np.abs(edge) >= gap) & (edge != 0)
    return res, bet


def rec(res, bet, mask):
    r = res[bet & mask]
    w, l = int((r > 0).sum()), int((r < 0).sum())
    return [w, l, round(w / (w + l), 4) if w + l else None]


builds = sorted(f[:-8] for f in os.listdir(BUILDS) if f.endswith(".parquet") and "teams" not in f)
rows = []
for build in builds:
    df = load(build)
    season = df.season.values
    masks = {"all": season >= 2021, "tune": (season >= 2021) & (season <= 2024), "test": season >= 2025,
             **{str(s): season == s for s in SEASONS}}
    for (fname, feats), alpha, qbs in itertools.product(FEATURES.items(), ALPHAS, QB_SCALES):
        if qbs != 1.0 and "qb_edge" not in feats:
            continue
        pred = predict(df, feats, alpha, qbs)
        row = {"build": build, "features": fname, "alpha": alpha, "qbScale": qbs}
        for label, line_col, gap in [("close", "spread_line", 0), ("open", "open", 0),
                                     ("close4", "spread_line", GAP), ("open4", "open", GAP)]:
            res, bet = grade(df, pred, line_col, gap)
            for key, m in masks.items():
                row[f"{label}_{key}"] = rec(res, bet, m)
        rows.append(row)
print("variants:", len(rows))

summary = {"variants": len(rows), "gap": GAP}
for label, min_bets in [("close", 600), ("open", 600), ("close4", 150), ("open4", 150)]:
    pool = [r for r in rows if r[f"{label}_all"][0] + r[f"{label}_all"][1] >= min_bets]
    best_all = sorted(pool, key=lambda r: -r[f"{label}_all"][2])
    tune_pool = [r for r in rows if r[f"{label}_tune"][0] + r[f"{label}_tune"][1] >= min_bets * 4 // 6]
    best_tune = sorted(tune_pool, key=lambda r: -r[f"{label}_tune"][2])[:10]
    tw = sum(r[f"{label}_test"][0] for r in best_tune); tl = sum(r[f"{label}_test"][1] for r in best_tune)
    summary[label] = {
        "over60": sum(1 for r in pool if r[f"{label}_all"][2] >= 0.6),
        "eligible": len(pool),
        "median": float(np.median([r[f"{label}_all"][2] for r in pool])) if pool else None,
        "best": [{k: r[k] for k in ("build", "features", "alpha", "qbScale")} | {"all": r[f"{label}_all"],
                  "bySeason": {s: r[f"{label}_{s}"] for s in map(str, SEASONS)}} for r in best_all[:5]],
        "top10TunedOn2021_24": {"tune": [sum(r[f"{label}_tune"][0] for r in best_tune), sum(r[f"{label}_tune"][1] for r in best_tune)],
                                "test2025_26": [tw, tl, round(tw / (tw + tl), 4) if tw + tl else None]},
    }
json.dump({"summary": summary, "rows": rows}, open(OUT, "w"), indent=1)
print(json.dumps(summary, indent=1))
