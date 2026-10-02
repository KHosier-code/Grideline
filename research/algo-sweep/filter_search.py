"""Search filter combinations on the opener-gap spread rule for a 60%+ record,
then repeat the search using only 2021-2024 to see whether winners found that
way keep winning on 2025-2026 games they were not tuned on.

The base rule: the walk-forward EPA rating (fit on earlier seasons only) is at
least `gap` points off the opening spread; bet its side at the opener.

Usage: filter_search.py <games.parquet from build_games.py> <nfelo_games.csv> <out.json>
"""
import itertools
import json
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
          "rest_diff", "hfa", "div_game"]
TARGET, MIN_BETS = 0.60, 100

g = pd.read_parquet(sys.argv[1])
g = g[g.played & g.spread_line.notna() & (g.season >= 2020)].copy()
g["hfa"] = 1 - g.neutral
n = pd.read_csv(sys.argv[2])[["game_id", "home_line_open"]]
n["game_id"] = n.game_id.str.replace(r"_(OAK|LAR|SD|STL)(?=_|$)",
                                     lambda m: "_" + {"OAK": "LV", "LAR": "LA", "SD": "LAC", "STL": "LA"}[m.group(1)], regex=True)
g = g.merge(n, on="game_id", how="left")
g["open"] = -g.home_line_open

parts = []
for season in range(2021, 2027):
    train = g[g.season < season].dropna(subset=RATING)
    test = g[g.season == season].copy()
    test["pred"] = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(train[RATING], train.margin).predict(test[RATING])
    parts.append(test)
p = pd.concat(parts).dropna(subset=["open"]).reset_index(drop=True)
p["gap"] = p.pred - p.open
p["side"] = np.sign(p.gap)                       # +1 bet home, -1 bet away
p["res_open"] = np.sign(p.margin - p.open) * p.side
p["res_close"] = np.sign(p.margin - p.spread_line) * p.side
fav = np.sign(p.open)                            # +1 home favoured at the open
p["on_dog"] = (p.side == -fav) & (fav != 0)
p["on_fav"] = (p.side == fav) & (fav != 0)
p["qb_change"] = (p.home_qb_new == 1) | (p.away_qb_new == 1)
p["outdoor_wind"] = np.where(p.dome == 1, 0, p.wind)

FILTERS = {
    "gap": {f"{t}+ pts": p.gap.abs() >= t for t in (2, 2.5, 3, 3.5, 4, 5, 6)},
    "side": {"any side": True, "on the underdog": p.on_dog, "on the favourite": p.on_fav,
             "on the home team": p.side > 0, "on the road team": p.side < 0},
    "spread": {"any spread": True, "spread 3 or less": p.open.abs() <= 3, "spread 7 or less": p.open.abs() <= 7,
               "spread over 3": p.open.abs() > 3},
    "qb": {"any QB": True, "no QB change": ~p.qb_change},
    "week": {"any week": True, "weeks 1-9": p.week <= 9, "week 10 on": p.week >= 10, "regular season": p.game_type == "REG"},
    "div": {"any opponent": True, "division games": p.div_game == 1, "non-division": p.div_game == 0},
}


def record(mask, col, seasons):
    sub = p[mask & p.season.isin(seasons)][col]
    w, l = int((sub > 0).sum()), int((sub < 0).sum())
    return w, l, (w / (w + l) if w + l else None)


def search(seasons, min_bets):
    found = []
    for combo in itertools.product(*[list(v.items()) for v in FILTERS.values()]):
        mask = np.ones(len(p), dtype=bool)
        for _, m in combo:
            mask &= np.asarray(m if not isinstance(m, bool) else np.full(len(p), m))
        w, l, rate = record(mask, "res_open", seasons)
        if rate is not None and w + l >= min_bets and rate >= TARGET:
            found.append({"filters": [name for name, _ in combo], "mask": mask, "w": w, "l": l, "rate": rate})
    found.sort(key=lambda f: (-f["rate"], -(f["w"] + f["l"])))
    return found


def describe(f):
    by_season = {int(s): record(f["mask"], "res_open", [s])[:2] for s in range(2021, 2027)}
    return {
        "filters": [x for x in f["filters"] if not x.startswith("any")],
        "record": [f["w"], f["l"]], "rate": round(f["rate"], 4),
        "bySeason": by_season,
        "atClose": record(f["mask"], "res_close", list(range(2021, 2027)))[:2],
        "holdout2025_26": record(f["mask"], "res_open", [2025, 2026])[:2],
    }


combos = int(np.prod([len(v) for v in FILTERS.values()]))
full = search(list(range(2021, 2027)), MIN_BETS)
tuned = search(list(range(2021, 2025)), int(MIN_BETS * 4 / 6))
hold = [record(f["mask"], "res_open", [2025, 2026]) for f in tuned]
hw, hl = sum(h[0] for h in hold[:20]), sum(h[1] for h in hold[:20])
out = {
    "combinationsTried": combos,
    "fullHistory": {"passing": len(full), "best": [describe(f) for f in full[:15]]},
    "tunedOn2021_24": {
        "passing": len(tuned), "best": [describe(f) for f in tuned[:15]],
        "top20On2025_26": [hw, hl, round(hw / (hw + hl), 4) if hw + hl else None],
        "allPassingOn2025_26": [sum(h[0] for h in hold), sum(h[1] for h in hold)],
    },
}
json.dump(out, open(sys.argv[3], "w"), indent=1, default=int)
print(json.dumps({k: v for k, v in out.items() if k != "fullHistory"} | {"fullPassing": len(full)}, indent=1, default=int)[:3000])
for f in full[:15]:
    d = describe(f)
    print(d["record"], round(d["rate"], 3), d["filters"], d["bySeason"], "close", d["atClose"])
