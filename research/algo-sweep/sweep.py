"""Backtest about 200 candidate game-prediction algorithms on the last three
completed NFL seasons, plus the 2026 games played so far.

Every algorithm is walk-forward: a prediction for a game uses only games played
before it, and anything fitted is fitted on earlier seasons only (2020 onward).
Each algorithm either predicts the home margin (graded against the closing and
opening spreads, straight-up winners and margin miss) or is a betting rule that
names a side.

Selection and holdout are kept apart so a lucky variant cannot pass as a good
one: algorithms are ranked on 2023-2024 only, and 2025 (then 2026 so far) is
the untouched test. A sign-flip test over the whole family says how good the
best of ~200 tries looks when nothing has any skill.

Usage: sweep.py <data dir> <builds dir> <out dir>
  data dir:   games.csv (nflverse) and nfelo_games.csv (opening lines, read
              from disk only; the nfelo repository has no license)
  builds dir: build_games.py outputs named hl<H>_c<C>_qb<Q>.parquet
"""
import itertools
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor, HistGradientBoostingClassifier
from sklearn.linear_model import ElasticNet, HuberRegressor, Lasso, LogisticRegression, Ridge
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA, BUILDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SELECT, HOLDOUT, LIVE = [2023, 2024], [2025], [2026]
TEST = SELECT + HOLDOUT + LIVE
FIRST_TRAIN = 2020
DEFAULT_BUILD = "hl6_c0.5_qb150"
RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
          "rest_diff", "hfa", "div_game"]
WEATHER = ["wind_out", "cold"]
rng = np.random.default_rng(20261001)


# ---------------------------------------------------------------- data
def load_build(name):
    df = pd.read_parquet(f"{BUILDS}/{name}.parquet")
    df = df[df.played & df.spread_line.notna() & (df.season >= 2019)].copy()
    df["hfa"] = 1 - df.neutral
    df["wind_out"] = np.where(df.dome == 1, 0.0, df.wind)
    df["cold"] = ((df.dome == 0) & (df.temp <= 32)).astype(int)
    return df.sort_values(["kickoff", "game_id"]).reset_index(drop=True)


base = load_build(DEFAULT_BUILD)
sched = pd.read_csv(f"{DATA}/games.csv")[["game_id", "weekday", "gametime", "home_rest", "away_rest"]]
nfelo = pd.read_csv(f"{DATA}/nfelo_games.csv")[["game_id", "home_line_open", "home_line_close"]]
# nfelo keeps old team codes in game ids (OAK, LAR); nflverse uses LV and LA.
nfelo["game_id"] = nfelo.game_id.str.replace(r"_(OAK|LAR|SD|STL)(?=_|$)", lambda m: "_" + {"OAK": "LV", "LAR": "LA", "SD": "LAC", "STL": "LA"}[m.group(1)], regex=True)
base = base.merge(sched, on="game_id", how="left").merge(nfelo, on="game_id", how="left")
base["open_line"] = -base.home_line_open  # expected home margin at the opener, same sign as spread_line

# Each team's previous game result in the same season (for bounce-back rules).
long = pd.concat([
    base[["game_id", "season", "kickoff", "home_team", "margin"]].set_axis(["game_id", "season", "kickoff", "team", "m"], axis=1),
    base[["game_id", "season", "kickoff", "away_team", "margin"]].assign(margin=lambda f: -f.margin)
        .set_axis(["game_id", "season", "kickoff", "team", "m"], axis=1),
]).sort_values("kickoff")
long["prev_m"] = long.groupby(["team", "season"]).m.shift(1)
prev = long.set_index(["game_id", "team"]).prev_m
base["home_prev"] = [prev.get((g, t), np.nan) for g, t in zip(base.game_id, base.home_team)]
base["away_prev"] = [prev.get((g, t), np.nan) for g, t in zip(base.game_id, base.away_team)]

EVAL = base.season.isin(TEST).values
ev = base[EVAL].reset_index(drop=True)
print("eval games", len(ev), "missing opener", int(ev.open_line.isna().sum()))


def walk(frame, fit_predict, first_train=FIRST_TRAIN):
    """Predictions for the eval rows, each test season fit on earlier seasons only."""
    out = pd.Series(np.nan, index=frame.index)
    for season in TEST:
        train = frame[(frame.season < season) & (frame.season >= first_train)]
        test = frame[frame.season == season]
        if len(test):
            out[test.index] = fit_predict(train, test)
    return out[frame.season.isin(TEST)].values


# ---------------------------------------------------------------- rating systems computed game by game
def elo_points(k, mov, regress, hfa_pts):
    """Pre-game Elo difference (home minus away) in points, 538-style, over 2019 onward."""
    rating, season_seen, out = {}, {}, np.zeros(len(base))
    for i, g in enumerate(base.itertuples()):
        for team in (g.home_team, g.away_team):
            r = rating.get(team, 1500.0)
            if season_seen.get(team) not in (None, g.season):
                r = 1500 + (r - 1500) * (1 - regress)
            rating[team], season_seen[team] = r, g.season
        h = hfa_pts * 25 * g.hfa
        diff = rating[g.home_team] - rating[g.away_team] + h
        out[i] = diff / 25
        expected = 1 / (1 + 10 ** (-diff / 400))
        actual = 1.0 if g.margin > 0 else 0.0 if g.margin < 0 else 0.5
        mult = 1.0
        if mov:
            winner_diff = diff if g.margin > 0 else -diff
            mult = np.log(abs(g.margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2) if g.margin != 0 else 1.0
        delta = k * mult * (actual - expected)
        rating[g.home_team] += delta
        rating[g.away_team] -= delta
    return out


def srs_points(half_life_weeks, carry, lam, cap=None):
    """Weighted least-squares team ratings from scoring margins before each week, plus fitted home field."""
    teams = sorted(set(base.home_team) | set(base.away_team))
    idx = {t: i for i, t in enumerate(teams)}
    home_i = base.home_team.map(idx).values
    away_i = base.away_team.map(idx).values
    margin = base.margin.clip(-cap, cap).values if cap else base.margin.values
    days = (base.kickoff - base.kickoff.min()).dt.days.values
    out = np.full(len(base), np.nan)
    for (season, week), grp in base[base.season >= FIRST_TRAIN].groupby(["season", "week"]):
        cutoff = grp.kickoff.min()
        hist = np.where((base.kickoff < cutoff).values & (base.season >= season - 2).values)[0]
        age_weeks = (days[grp.index[0]] - days[hist]) / 7
        w = 0.5 ** (age_weeks / half_life_weeks) * carry ** (season - base.season.values[hist])
        X = np.zeros((len(hist), len(teams) + 1))
        X[np.arange(len(hist)), home_i[hist]] = 1
        X[np.arange(len(hist)), away_i[hist]] = -1
        X[:, -1] = base.hfa.values[hist]
        sw = np.sqrt(w)
        A = X * sw[:, None]
        reg = np.eye(len(teams) + 1) * lam
        reg[-1, -1] = 1e-6
        coef = np.linalg.solve(A.T @ A + reg, A.T @ (margin[hist] * sw))
        gi = grp.index.values
        out[gi] = coef[home_i[gi]] - coef[away_i[gi]] + coef[-1] * base.hfa.values[gi]
    return out


# ---------------------------------------------------------------- algorithm registry
ALGOS = []  # dicts: id, family, name, params, kind ('margin' or 'rule'), pred | picks_close/picks_open


def add_margin(family, name, pred, uses_close=False, **params):
    """uses_close: the prediction is built from the closing line, so it can only be graded against the close."""
    ALGOS.append({"id": len(ALGOS) + 1, "family": family, "name": name, "params": params, "kind": "margin",
                  "pred": np.asarray(pred, dtype=float), "uses_close": uses_close})


def add_rule(family, name, fn, close_only=False, **params):
    picks_close = np.sign(np.nan_to_num(fn(ev, ev.spread_line.values), nan=0.0))
    picks_open = None if close_only else np.sign(np.nan_to_num(fn(ev, ev.open_line.values), nan=0.0))
    ALGOS.append({"id": len(ALGOS) + 1, "family": family, "name": name, "params": params, "kind": "rule",
                  "picks_close": picks_close, "picks_open": picks_open})


def ridge_fit(features, alpha=10, target="margin", model=None):
    def fp(train, test):
        train = train.dropna(subset=features)
        m = model() if model else make_pipeline(StandardScaler(), Ridge(alpha=alpha))
        m.fit(train[features].values, train[target].values)
        return m.predict(test[features].fillna(0).values)
    return fp


def scaled_feature(features, feature, scale, alpha=10):
    """Fit the rating, then scale one feature's contribution (e.g. QB effect x1.5)."""
    def fp(train, test):
        m = make_pipeline(StandardScaler(), Ridge(alpha=alpha)).fit(train[features].values, train.margin.values)
        X = test[features].values.copy()
        full = m.predict(X)
        X[:, features.index(feature)] = train[feature].mean()
        without = m.predict(X)
        return without + scale * (full - without)
    return fp


def fixed_hfa(h, alpha=10):
    feats = [f for f in RATING if f != "hfa"]
    def fp(train, test):
        m = make_pipeline(StandardScaler(), Ridge(alpha=alpha)).fit(train[feats].values, (train.margin - h * train.hfa).values)
        return m.predict(test[feats].values) + h * test.hfa.values
    return fp


# 1. Baselines
add_margin("Baseline", "Home field only (fitted average home margin)", walk(base, lambda tr, te: np.full(len(te), tr[tr.hfa == 1].margin.mean()) * te.hfa.values))
add_margin("Baseline", "Opening line as the prediction", ev.open_line.values)

# 2. Elo from scores only, plus versions with QB and calibration fitted on earlier seasons
elo_cache = {}
for k, mov, regress, hfa_pts in itertools.product([12, 20, 28], [False, True], [0.25, 0.5], [1.5, 2.5]):
    pts = elo_points(k, mov, regress, hfa_pts)
    elo_cache[(k, mov, regress, hfa_pts)] = pts
    add_margin("Elo", f"Elo K={k}{', margin-of-victory' if mov else ''}, regress {int(regress*100)}%, HFA {hfa_pts}",
               pts[EVAL], k=k, mov=mov, regress=regress, hfa=hfa_pts)
for key in [(20, True, 0.25, 1.5), (20, True, 0.5, 1.5), (28, True, 0.25, 2.5), (12, False, 0.25, 1.5)]:
    base["elo_tmp"] = elo_cache[key]
    add_margin("Elo + QB", f"Elo K={key[0]}{' MOV' if key[1] else ''} regress {int(key[2]*100)}% + starting QB + rest (fitted)",
               walk(base, ridge_fit(["elo_tmp", "qb_edge", "qb_new_edge", "rest_diff"])), k=key[0])
for key in [(20, True, 0.25, 1.5), (28, True, 0.5, 2.5)]:
    base["elo_tmp"] = elo_cache[key]
    add_margin("Elo", f"Elo K={key[0]} MOV regress {int(key[2]*100)}%, scale and home field fitted",
               walk(base, ridge_fit(["elo_tmp", "hfa"], alpha=1)), k=key[0])
base["elo_main"] = elo_cache[(20, True, 0.25, 1.5)]
base["elo_qb"] = np.nan
base.loc[base.season.isin(TEST), "elo_qb"] = ALGOS[[a["name"] for a in ALGOS].index(
    "Elo K=20 MOV regress 25% + starting QB + rest (fitted)")]["pred"]

# 3. Point-differential (SRS-style) ratings
srs_cache = {}
for hl, carry, lam in itertools.product([4, 8, 16, 32], [0.3, 0.6], [1, 10]):
    pts = srs_points(hl, carry, lam)
    srs_cache[(hl, carry, lam)] = pts
    add_margin("Point-differential rating", f"Point differential, half-life {hl} wk, last season x{carry}, ridge {lam}",
               pts[EVAL], half_life=hl, carry=carry, ridge=lam)
for hl, carry in [(8, 0.6), (16, 0.6), (16, 0.3), (32, 0.6)]:
    add_margin("Point-differential rating", f"Point differential capped at 21, half-life {hl} wk, last season x{carry}",
               srs_points(hl, carry, 1, cap=21)[EVAL], half_life=hl, carry=carry, cap=21)
for hl, carry in [(8, 0.6), (16, 0.6), (16, 0.3), (32, 0.6)]:
    base["srs_tmp"] = srs_cache[(hl, carry, 10)]
    add_margin("Point-differential + QB", f"Point differential (half-life {hl} wk, x{carry}) + starting QB + rest (fitted)",
               walk(base, ridge_fit(["srs_tmp", "qb_edge", "qb_new_edge", "rest_diff"])), half_life=hl, carry=carry)
base["srs_main"] = srs_cache[(16, 0.6, 10)]

# 4. EPA power rating (the site's current model family) across 14 feature builds
for build in sorted(f[:-8] for f in os.listdir(BUILDS) if f.endswith(".parquet") and "teams" not in f):
    frame = base if build == DEFAULT_BUILD else load_build(build)
    if build != DEFAULT_BUILD:
        frame = frame.set_index("game_id").loc[base.game_id].reset_index()
    hl, carry, qb = build.split("_")
    label = f"EPA half-life {hl[2:]} games, last season x{carry[1:]}, QB prior {qb[2:]} dropbacks"
    add_margin("EPA rating", f"{label}: full", walk(frame, ridge_fit(RATING)), build=build, features="full")
    add_margin("EPA rating + weather", f"{label}: full + wind and cold", walk(frame, ridge_fit(RATING + WEATHER)), build=build, features="full+weather")
    add_margin("EPA rating, no QB", f"{label}: team EPA only (no QB terms)",
               walk(frame, ridge_fit([f for f in RATING if not f.startswith("qb_")])), build=build, features="no QB")
base["epa_main"] = np.nan
base.loc[base.season.isin(TEST), "epa_main"] = ALGOS[[a.get("params", {}).get("build") == DEFAULT_BUILD and a["params"].get("features") == "full" for a in ALGOS].index(True)]["pred"]

for alpha in [0.1, 1, 30, 100, 1000]:
    add_margin("EPA rating: regularization", f"EPA rating, ridge alpha {alpha}", walk(base, ridge_fit(RATING, alpha=alpha)), alpha=alpha)
ABLATIONS = {
    "EPA/play + QB + home field": ["epa_edge", "qb_edge", "hfa"],
    "Success rate + QB + home field": ["success_edge", "qb_edge", "hfa"],
    "Pass/rush EPA split + QB + home field": ["pass_edge", "rush_edge", "qb_edge", "hfa"],
    "QB value + home field + rest only": ["qb_edge", "qb_new_edge", "hfa", "rest_diff"],
    "Full minus rest": [f for f in RATING if f != "rest_diff"],
    "Full minus division": [f for f in RATING if f != "div_game"],
    "Full minus CPOE": [f for f in RATING if f != "qb_cpoe_edge"],
}
for name, feats in ABLATIONS.items():
    add_margin("EPA rating: feature subsets", f"EPA rating: {name}", walk(base, ridge_fit(feats)), features=name)

# 5. Other model types on the same features
ML = {
    "Gradient boosting (depth 3)": lambda: HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=200, random_state=0),
    "Random forest (leaf 20)": lambda: RandomForestRegressor(n_estimators=300, min_samples_leaf=20, random_state=0, n_jobs=-1),
    "k-nearest neighbours (k=75)": lambda: make_pipeline(StandardScaler(), KNeighborsRegressor(75)),
    "Huber regression (outlier-robust)": lambda: make_pipeline(StandardScaler(), HuberRegressor(max_iter=1000)),
    "Lasso": lambda: make_pipeline(StandardScaler(), Lasso(alpha=0.1)),
    "Elastic net": lambda: make_pipeline(StandardScaler(), ElasticNet(alpha=0.2, l1_ratio=0.5)),
}
for name, model in ML.items():
    add_margin("Other model types", name, walk(base, ridge_fit(RATING + WEATHER, model=model)), model=name)

# 6. Home field, rest, QB strength and weather adjustments
for h in [0, 1, 1.5, 2, 2.5, 3]:
    add_margin("Home field", f"EPA rating with home field fixed at {h} pts", walk(base, fixed_hfa(h)), hfa=h)
add_margin("Rest", "EPA rating, rest ignored", walk(base, scaled_feature(RATING, "rest_diff", 0)), rest_scale=0)
add_margin("Rest", "EPA rating, rest effect doubled", walk(base, scaled_feature(RATING, "rest_diff", 2)), rest_scale=2)
base["home_bye"] = (base.home_rest >= 13).astype(int) - (base.away_rest >= 13).astype(int)
base["short_week"] = (base.home_rest <= 5).astype(int) - (base.away_rest <= 5).astype(int)
add_margin("Rest", "EPA rating, bye-week and short-week flags instead of rest days",
           walk(base, ridge_fit([f for f in RATING if f != "rest_diff"] + ["home_bye", "short_week"])))
for s in [0, 0.5, 1.5, 2]:
    add_margin("QB adjustment", f"EPA rating, QB effect x{s}", walk(base, scaled_feature(RATING, "qb_edge", s)), qb_scale=s)
base["wind_pass"] = base.wind_out * base.pass_edge
base["wind_qb"] = base.wind_out * base.qb_edge
base["cold_home"] = base.cold * base.hfa
for name, extra in [("wind x passing edge", ["wind_pass"]), ("wind x QB edge", ["wind_qb"]), ("cold-weather home field", ["cold_home"])]:
    add_margin("Weather", f"EPA rating + {name}", walk(base, ridge_fit(RATING + extra)), weather=name)

# 7. Blends with the opening line (no closing-line information is used)
open_eval = ev.open_line.values
ens3 = np.nanmean(np.vstack([base.loc[EVAL, "elo_qb"], base.loc[EVAL, "epa_main"], srs_cache[(16, 0.6, 10)][EVAL]]), axis=0)
for w in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
    add_margin("Blend with opening line", f"{int(w*100)}% EPA rating + {int(100-w*100)}% opening line",
               w * base.loc[EVAL, "epa_main"].values + (1 - w) * open_eval, weight=w)
for label, pred in [("Elo + QB", base.loc[EVAL, "elo_qb"].values), ("Point differential", srs_cache[(16, 0.6, 10)][EVAL]),
                    ("3-model average", ens3)]:
    for w in [0.25, 0.5, 0.75]:
        add_margin("Blend with opening line", f"{int(w*100)}% {label} + {int(100-w*100)}% opening line",
                   w * pred + (1 - w) * open_eval, weight=w, model=label)


# 8. Market-aware: start from a line and move off it only as far as the signals justify
def market_aware(line_col, alpha):
    def fp(train, test):
        train = train.dropna(subset=[line_col, "epa_main_all"])
        x = lambda f: np.column_stack([f.epa_main_all - f[line_col], f.qb_new_edge, f.qb_edge, f.rest_diff])
        m = Ridge(alpha=alpha).fit(x(train), train.margin - train[line_col])
        return test[line_col].values + m.predict(np.nan_to_num(x(test)))  # NaN where the line is missing
    return fp


# market-aware needs in-sample EPA ratings on training seasons too: refit each season's rating on its own past.
base["epa_main_all"] = np.nan
for season in range(2021, 2027):
    tr = base[(base.season < season) & (base.season >= FIRST_TRAIN)]
    te = base[base.season == season]
    m = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(tr[RATING], tr.margin)
    base.loc[te.index, "epa_main_all"] = m.predict(te[RATING])
for line_col, label in [("open_line", "opening"), ("spread_line", "closing")]:
    for alpha in [50, 200, 1000]:
        add_margin("Market-aware", f"Market-aware off the {label} line (shrink {alpha})",
                   walk(base, market_aware(line_col, alpha), first_train=2021), uses_close=label == "closing", line=label, alpha=alpha)
# Trained directly on beating the closing line.
base["cover_close"] = base.margin - base.spread_line
for alpha in [10, 100, 1000]:
    def fp(train, test, alpha=alpha):
        feats = RATING + ["spread_line"]
        m = make_pipeline(StandardScaler(), Ridge(alpha=alpha)).fit(train[feats], train.cover_close)
        return test.spread_line.values + m.predict(test[feats])
    add_margin("Trained on the spread", f"Ridge trained on cover margin vs close (alpha {alpha})", walk(base, fp), uses_close=True, alpha=alpha)


def cover_classifier(model, feats):
    def fp(train, test):
        train = train[(train.cover_close != 0)].dropna(subset=feats)
        m = model().fit(train[feats].values, (train.cover_close > 0).astype(int))
        p = m.predict_proba(test[feats].fillna(0).values)[:, 1]
        return test.spread_line.values + (p - 0.5) * 20  # a side, expressed as a margin either side of the line
    return fp


base["edge_close"] = base.epa_main_all - base.spread_line
for name, model, feats in [
    ("Logistic: cover vs close from rating edge", lambda: LogisticRegression(max_iter=2000), ["edge_close"]),
    ("Logistic: cover vs close from all features", lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=2000)), RATING + ["spread_line", "edge_close"]),
    ("Gradient boosting classifier: cover vs close", lambda: HistGradientBoostingClassifier(max_depth=2, learning_rate=0.03, max_iter=150, random_state=0), RATING + WEATHER + ["spread_line", "edge_close"]),
]:
    pred = walk(base, cover_classifier(model, feats), first_train=2021)
    ALGOS.append({"id": len(ALGOS) + 1, "family": "Trained on the spread", "name": name, "params": {}, "kind": "rule",
                  "picks_close": np.sign(pred - ev.spread_line.values), "picks_open": None})

# 9. Ensembles and shrinkage
elo_pts = elo_cache[(20, True, 0.25, 1.5)][EVAL]
srs = srs_cache[(16, 0.6, 10)][EVAL]
epa = base.loc[EVAL, "epa_main"].values
eloqb = base.loc[EVAL, "elo_qb"].values
margin_preds = np.vstack([a["pred"] for a in ALGOS if a["kind"] == "margin" and a["family"] not in ("Baseline", "Blend with opening line", "Market-aware", "Trained on the spread")])
for name, pred in [("Elo + point differential", (elo_pts + srs) / 2), ("Elo + EPA rating", (elo_pts + epa) / 2),
                   ("Point differential + EPA rating", (srs + epa) / 2), ("Elo + point differential + EPA", (elo_pts + srs + epa) / 3),
                   ("Elo-QB + point differential + EPA", ens3), ("Median of all rating models", np.nanmedian(margin_preds, axis=0))]:
    add_margin("Ensembles", f"Average: {name}", pred)
base["srs_main"], base["elo_main"] = srs_cache[(16, 0.6, 10)], elo_cache[(20, True, 0.25, 1.5)]
add_margin("Ensembles", "Stacked: ridge on Elo, point differential, EPA features",
           walk(base, ridge_fit(["srs_main", "elo_main"] + RATING)))
for s in [0.5, 0.75, 1.25]:
    add_margin("Shrinkage", f"EPA rating x{s} (toward a pick'em)", s * epa, scale=s)


# 10. Betting rules that name a side. line = expected home margin (positive: home favoured).
def fav(line):
    return np.sign(line)


def prev_rule(f, line, kind):
    h, a = f.home_prev.values, f.away_prev.values
    if kind == "fade_blowout_win":
        return np.where((h >= 20) & ~(a >= 20), -1, np.where((a >= 20) & ~(h >= 20), 1, 0))
    if kind == "back_blowout_loss":
        return np.where((h <= -20) & ~(a <= -20), 1, np.where((a <= -20) & ~(h <= -20), -1, 0))
    return np.where((h < 0) & (a > 0), 1, np.where((a < 0) & (h > 0), -1, 0))


WEST = {"SEA", "SF", "LA", "LAC", "LV"}
EAST = {"NE", "NYJ", "NYG", "BUF", "MIA", "PHI", "WAS", "BAL", "PIT", "CLE", "CIN", "DET", "ATL", "CAR", "TB", "JAX", "IND"}
RULES = [
    ("Always the home team", lambda f, l: np.ones(len(f))),
    ("Always the road team", lambda f, l: -np.ones(len(f))),
    ("Always the favourite", lambda f, l: fav(l)),
    ("Always the underdog", lambda f, l: -fav(l)),
    ("Home underdogs", lambda f, l: np.where(l < 0, 1, 0)),
    ("Road underdogs", lambda f, l: np.where(l > 0, -1, 0)),
    ("Underdogs of 7+", lambda f, l: np.where(np.abs(l) >= 7, -fav(l), 0)),
    ("Underdogs of 10+", lambda f, l: np.where(np.abs(l) >= 10, -fav(l), 0)),
    ("Favourites of 3 or less", lambda f, l: np.where((np.abs(l) <= 3) & (l != 0), fav(l), 0)),
    ("Favourites of 10+", lambda f, l: np.where(np.abs(l) >= 10, fav(l), 0)),
    ("Division underdogs", lambda f, l: np.where(f.div_game == 1, -fav(l), 0)),
    ("Division home underdogs", lambda f, l: np.where((f.div_game == 1) & (l < 0), 1, 0)),
    ("Team with more rest", lambda f, l: np.sign(f.rest_diff.values)),
    ("Team coming off a bye", lambda f, l: np.where((f.home_rest >= 13) & (f.away_rest < 13), 1, np.where((f.away_rest >= 13) & (f.home_rest < 13), -1, 0))),
    ("Fade the team on a short week", lambda f, l: np.where((f.home_rest <= 5) & (f.away_rest > 5), -1, np.where((f.away_rest <= 5) & (f.home_rest > 5), 1, 0))),
    ("Fade a team that won its last game by 20+", lambda f, l: prev_rule(f, l, "fade_blowout_win")),
    ("Back a team that lost its last game by 20+", lambda f, l: prev_rule(f, l, "back_blowout_loss")),
    ("Back last week's loser against last week's winner", lambda f, l: prev_rule(f, l, "bounce")),
    ("Underdogs in 15+ mph wind", lambda f, l: np.where(f.wind_out >= 15, -fav(l), 0)),
    ("Underdogs from week 13 on", lambda f, l: np.where((f.week >= 13) & (f.game_type == "REG"), -fav(l), 0)),
    ("Underdogs in weeks 1-4", lambda f, l: np.where(f.week <= 4, -fav(l), 0)),
    ("Playoff favourites", lambda f, l: np.where(f.game_type != "REG", fav(l), 0)),
    ("Underdog with the better starting QB", lambda f, l: np.where(np.sign(f.qb_edge.values) == -fav(l), -fav(l), 0)),
    ("Fade a team starting a new QB", lambda f, l: np.where((f.home_qb_new == 1) & (f.away_qb_new == 0), -1, np.where((f.away_qb_new == 1) & (f.home_qb_new == 0), 1, 0))),
    ("Fade West Coast teams in 1pm Eastern games", lambda f, l: np.where(f.away_team.isin(WEST) & f.home_team.isin(EAST) & (f.gametime.fillna("") <= "13:00") & (f.hfa == 1), 1, 0)),
    ("Home team at 32F or colder", lambda f, l: np.where(f.cold == 1, 1, 0)),
    ("Thursday home teams", lambda f, l: np.where(f.weekday == "Thursday", 1, 0)),
    ("Monday night underdogs", lambda f, l: np.where(f.weekday == "Monday", -fav(l), 0)),
]
for name, fn in RULES:
    add_rule("Betting rules", name, fn)
# Line movement is only known at the close, so these are graded against the close only.
add_rule("Betting rules", "Follow the line move (bet at the close)", lambda f, l: np.sign(f.spread_line.values - f.open_line.values), close_only=True)
print("algorithms:", len(ALGOS))


# ---------------------------------------------------------------- grading
cover_c = ev.margin.values - ev.spread_line.values
cover_o = ev.margin.values - ev.open_line.values
season = ev.season.values


def results(picks, cover):
    """+1 win, -1 loss, 0 push, NaN no bet."""
    out = np.full(len(picks), np.nan)
    bet = (picks != 0) & ~np.isnan(picks) & ~np.isnan(cover)
    out[bet] = np.where(cover[bet] == 0, 0, np.where(np.sign(cover[bet]) == picks[bet], 1, -1))
    return out


def rec(r, mask):
    r = r[mask]
    w, l, p = int((r == 1).sum()), int((r == -1).sum()), int((r == 0).sum())
    return {"w": w, "l": l, "p": p, "pct": round(w / (w + l), 4) if w + l else None}


masks = {"select": np.isin(season, SELECT), "holdout": np.isin(season, HOLDOUT), "live": np.isin(season, LIVE),
         **{str(s): season == s for s in TEST}}
BIG_EDGE = 2.0  # points between a margin prediction and the line
R = {"close": [], "open": [], "close2": [], "open2": []}
rows = []
for a in ALGOS:
    pc2 = po2 = None
    if a["kind"] == "margin":
        pred = a["pred"]
        pc = np.sign(pred - ev.spread_line.values)
        po = None if a["uses_close"] else np.sign(pred - ev.open_line.values)
        pc[np.isnan(pred)] = np.nan
        pc2 = np.where(np.abs(pred - ev.spread_line.values) >= BIG_EDGE, pc, 0)
        if po is not None:
            po[np.isnan(pred)] = np.nan
            po2 = np.where(np.abs(pred - ev.open_line.values) >= BIG_EDGE, po, 0)
    else:
        pred, pc, po = None, a["picks_close"], a["picks_open"]
    graded = {"close": results(pc, cover_c), "open": results(po, cover_o) if po is not None else None,
              "close2": results(pc2, cover_c) if pc2 is not None else None,
              "open2": results(po2, cover_o) if po2 is not None else None}
    row = {"id": a["id"], "family": a["family"], "name": a["name"], "kind": a["kind"], "params": a["params"],
           "usesClose": bool(a.get("uses_close")) or po is None}
    for label, r in graded.items():
        R[label].append(r if r is not None else np.full(len(ev), np.nan))
        for key, m in masks.items():
            row[f"{label}_{key}"] = rec(r, m) if r is not None else None
    if pred is not None:
        ok = ~np.isnan(pred)
        decided = ok & (ev.margin.values != 0) & (pred != 0)
        for key, m in masks.items():
            row[f"mae_{key}"] = round(float(np.mean(np.abs(pred - ev.margin.values)[ok & m])), 3)
            row[f"su_{key}"] = round(float((np.sign(pred) == np.sign(ev.margin.values))[decided & m].mean()), 4)
        # Closing line value: when the model is 1+ pt off the opener, does the line move its way?
        move = ev.spread_line.values - ev.open_line.values
        d = pred - ev.open_line.values
        sel = ok & (np.abs(d) >= 1) & ~np.isnan(move) & (move != 0) & (not a["uses_close"])
        for key, m in masks.items():
            s = sel & m
            row[f"clv_{key}"] = {"n": int(s.sum()), "toward": round(float((np.sign(move[s]) == np.sign(d[s])).mean()), 4) if s.any() else None}
    rows.append(row)
R = {label: np.array(v) for label, v in R.items()}

# Benchmarks the margin models are compared with.
line_mae = {k: round(float(np.mean(np.abs(ev.spread_line.values - ev.margin.values)[m])), 3) for k, m in masks.items()}
open_mae = {k: round(float(np.nanmean(np.abs(ev.open_line.values - ev.margin.values)[m])), 3) for k, m in masks.items()}
fav_pick = np.where(ev.spread_line != 0, np.sign(ev.spread_line), np.sign(ev.away_moneyline - ev.home_moneyline))
dec = ev.margin.values != 0
fav_su = {k: round(float((fav_pick == np.sign(ev.margin.values))[dec & m].mean()), 4) for k, m in masks.items()}


# ---------------------------------------------------------------- how good does the best of ~200 look by luck?
def sign_flip_max(R, mask, sims=4000, min_bets=100):
    """Null: no algorithm has skill, so each game's cover is a coin flip. Flipping a
    game's outcome flips it for every algorithm at once, which keeps the
    correlation between similar algorithms."""
    sub = R[:, mask]
    n = (~np.isnan(sub) & (sub != 0)).sum(axis=1)
    eligible = n >= min_bets
    S = np.nan_to_num(sub)
    maxes = np.empty(sims)
    for i in range(sims):
        f = rng.choice([-1.0, 1.0], size=sub.shape[1])
        x = S * f
        wins = (x == 1).sum(axis=1)
        maxes[i] = (wins / np.maximum(n, 1))[eligible].max()
    return maxes, n, eligible


null = {}
for label, matrix in R.items():
    maxes, n, eligible = sign_flip_max(matrix, masks["select"], min_bets=100 if label in ("close", "open") else 60)
    null[label] = {"p50": round(float(np.percentile(maxes, 50)), 4), "p95": round(float(np.percentile(maxes, 95)), 4),
                   "p99": round(float(np.percentile(maxes, 99)), 4)}
    for row, ok in zip(rows, eligible):
        sel = row[f"{label}_select"]
        row[f"{label}_adj_p"] = round(float((maxes >= sel["pct"]).mean()), 4) if ok and sel and sel["pct"] is not None else None
    null[label]["minBets"] = 100 if label in ("close", "open") else 60


def binom_p(w, l, p0=0.5):
    """One-sided P(at least w wins in w+l bets | true rate p0), normal approximation with continuity."""
    n = w + l
    if n == 0:
        return None
    from math import erf, sqrt
    z = (w - 0.5 - n * p0) / sqrt(n * p0 * (1 - p0))
    return round(0.5 * (1 - erf(z / sqrt(2))), 4)


for row in rows:
    for label in R:
        for key in ("select", "holdout", "live"):
            r = row.get(f"{label}_{key}")
            row[f"{label}_{key}_p"] = binom_p(r["w"], r["l"]) if r else None

os.makedirs(OUT, exist_ok=True)
# Game-level predictions of the main models, for the robustness checks in report.py.
keep = ["game_id", "season", "week", "game_type", "home_team", "away_team", "margin", "spread_line", "open_line",
        "home_qb_new", "away_qb_new", "qb_edge", "wind_out", "dome", "cold"]
games_out = ev[keep].copy()
games_out["epa_rating"] = base.loc[EVAL, "epa_main"].values
games_out["elo_qb"] = base.loc[EVAL, "elo_qb"].values
games_out["point_diff"] = srs_cache[(16, 0.6, 10)][EVAL]
games_out.to_parquet(f"{OUT}/eval_games.parquet")
summary = {
    "generated": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"),
    "selectSeasons": SELECT, "holdoutSeasons": HOLDOUT, "liveSeasons": LIVE,
    "games": {k: int(m.sum()) for k, m in masks.items()},
    "breakEven": 0.5238,
    "lineMae": line_mae, "openMae": open_mae, "favouriteSU": fav_su,
    "nullMax": null,
    "algorithms": rows,
}
with open(f"{OUT}/sweep_results.json", "w") as handle:
    json.dump(summary, handle, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
print(json.dumps({k: summary[k] for k in ("games", "lineMae", "favouriteSU", "nullMax")}, indent=1))
