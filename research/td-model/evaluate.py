import json
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

df = pd.read_parquet(sys.argv[1] if len(sys.argv) > 1 else "td_dataset.parquet")
df = df[(df.prior_games >= 1) & df.implied.notna() & (df.upcoming == 0)].copy()
for p in ["QB", "RB", "WR", "TE"]:
    df[f"pos_{p}"] = (df.position == p).astype(int)

USAGE = ["l3_targets", "l8_targets", "l3_carries", "l8_carries", "tgt_share8", "car_share8", "tgt_share3",
         "car_share3", "l8_receiving_yards", "l8_rushing_yards", "l8_receptions", "prior_games", "same_team_prev"]
REDZONE = ["l8_rz20_tgt", "l8_rz20_car", "l8_rz10_tgt", "l8_rz10_car", "l8_rz5_tgt", "l8_rz5_car",
           "rz20_tgt_share8", "rz20_car_share8", "rz10_car_share8", "rz5_car_share8", "rz5_tgt_share8",
           "rz_opps8", "gl_opps8", "rz_opps17", "implied_share_rz"]
HISTORY = ["td_rate_shrunk", "l8_tds", "l17_label"]
DEFENSE = ["opp_pos_tds8_shrunk", "opp_pos_tds_ratio", "opp_rz_allowed8"]
CONTEXT = ["implied", "opp_implied", "is_home", "team_rz_pg8"]
POS = ["pos_QB", "pos_RB", "pos_WR", "pos_TE"]
GROUPS = {"usage": USAGE, "redzone": REDZONE, "history": HISTORY, "defense": DEFENSE, "context": CONTEXT}
ALL = USAGE + REDZONE + HISTORY + DEFENSE + CONTEXT + POS

train = df[df.season.between(2020, 2023)]
valid = df[df.season == 2024]
test = df[df.season >= 2025]


def logit_model():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.3, max_iter=3000))


def gbm_model():
    return HistGradientBoostingClassifier(max_iter=400, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=80,
                                          l2_regularization=1.0, random_state=7)


def top_n_hit(frame, prob, n):
    f = frame.assign(p=prob)
    hits = f.sort_values("p", ascending=False).groupby(["season", "week"]).head(n)
    return hits.label.mean(), hits.p.mean()


def metrics(name, frame, prob):
    return {
        "model": name,
        "n": len(frame),
        "brier": round(brier_score_loss(frame.label, prob), 4),
        "logloss": round(log_loss(frame.label, prob), 4),
        "auc": round(roc_auc_score(frame.label, prob), 4),
        "top10_hit": round(top_n_hit(frame, prob, 10)[0], 3),
        "top10_pred": round(top_n_hit(frame, prob, 10)[1], 3),
        "top25_hit": round(top_n_hit(frame, prob, 25)[0], 3),
    }


results = []
# Baselines
pos_rate = train.groupby("position").label.mean()
results.append(metrics("baseline: position rate", test, test.position.map(pos_rate)))
results.append(metrics("baseline: player TD rate (shrunk)", test, test.td_rate_shrunk.clip(0.01, 0.99)))

fits = {}
for name, maker, feats in [
    ("logistic: all", logit_model, ALL),
    ("gbm: all", gbm_model, ALL),
]:
    m = maker().fit(train[feats], train.label)
    fits[name] = (m, feats)
    results.append(metrics(name, test, m.predict_proba(test[feats])[:, 1]))

for group, cols in GROUPS.items():
    feats = [f for f in ALL if f not in cols]
    m = gbm_model().fit(train[feats], train.label)
    results.append(metrics(f"gbm without {group}", test, m.predict_proba(test[feats])[:, 1]))

print(pd.DataFrame(results).to_string(index=False))
if len(sys.argv) > 2:
    main = next(r for r in results if r["model"] == "gbm: all")
    seasons = sorted(test.season.unique())
    tested_on = f"{seasons[0]}" + (f"–{seasons[-1]}" if len(seasons) > 1 else "")
    json.dump({"topTenHitRate": main["top10_hit"], "auc": main["auc"],
               "testedOn": f"{len(test):,} player-games from {tested_on} the model never trained on"},
              open(sys.argv[2], "w"))

# Calibration of the GBM on test
m, feats = fits["gbm: all"]
p = m.predict_proba(test[feats])[:, 1]
bins = pd.cut(p, [0, .05, .1, .15, .2, .25, .3, .35, .4, .5, .6, 1])
print(test.assign(p=p, bin=bins).groupby("bin", observed=True).agg(n=("label", "size"), predicted=("p", "mean"), actual=("label", "mean")).round(3).to_string())

# By position
print(test.assign(p=p).groupby("position").agg(n=("label", "size"), predicted=("p", "mean"), actual=("label", "mean")).round(3).to_string())
by_pos_auc = {pos: round(roc_auc_score(g.label, p[test.position.values == pos]), 3) for pos, g in test.groupby("position")}
print("AUC by position", by_pos_auc)
