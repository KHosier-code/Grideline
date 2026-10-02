"""Backtest of approaches inferred from Venom Analytics' public descriptions, 2021 through 2026 week 3.

Venom's method is not published. Its public pages describe an MLB home-run tool
with a proprietary "Venom Score" that ranks every player daily, a "DUE" tag for
players whose underlying numbers are running ahead of their results, a
"PITCHER VULNERABLE" tag for weak opponents, and a co-founder posting weekly
"NFL Touchdown Watch" posts. Their NFL product is touchdown props, not spreads.
So this file recreates those ideas for NFL anytime touchdowns, plus a
team-level "due for points" version graded against the spread:

Player picks (top N each week, graded like td_backtest.py: did he score a TD):
  - Venom Score: equal-weight z-score of red-zone opportunity, target/carry
    share, team implied total and how many TDs the opponent allows the position.
  - DUE: expected TDs from the last 8 games' red-zone and goal-line touches
    (rates fit on earlier seasons) minus TDs actually scored, among players with
    real red-zone volume.
  - Venom Score, DUE only: Venom Score top N among players tagged DUE.
  - Touchdown Watch: most touches last game that ended inside the 5 without a TD.
  - Gridline TD model (live) and the player's own TD rate, for comparison.

Team spread rules (walk-forward, every input from earlier games only):
  - "Due" offense: yards per point, or red-zone trips minus red-zone TDs
    (expected at the league rate), over the last 3 or 8 games.
  - Bet the team that is more "due" than its opponent when the gap is large;
    graded at the opening and closing spread.

Usage: venom_backtest.py <data dir> <td_dataset.parquet> <games.parquet> <nfelo_games.csv> <out.json>
"""
import itertools
import json
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import PoissonRegressor

sys.path.insert(0, __file__.rsplit("/", 2)[0] + "/td-model")
from features import ALL  # noqa: E402

DATA, TD_PATH, GAMES_PATH, NFELO_PATH, OUT = sys.argv[1:6]
SEASONS = list(range(2019, 2027))
TEST = list(range(2021, 2027))
TOP_N = [1, 3, 5, 10]
ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA"}


# ---------------------------------------------------------------- play-by-play: near misses and team red zone
def load_pbp():
    frames = []
    for s in SEASONS:
        p = pd.read_parquet(f"{DATA}/pbp_{s}.parquet", columns=[
            "game_id", "season_type", "posteam", "yardline_100", "yards_gained", "touchdown", "td_team",
            "rusher_player_id", "receiver_player_id", "complete_pass", "rush_attempt", "play_type",
            "fumble_lost", "interception", "fixed_drive", "fixed_drive_result", "two_point_attempt"])
        frames.append(p[(p.season_type == "REG") & p.play_type.isin(["pass", "run"]) & (p.two_point_attempt != 1)])
    return pd.concat(frames, ignore_index=True)


pbp = load_pbp()
pbp["posteam"] = pbp.posteam.replace(ALIASES)
end = pbp.yardline_100 - pbp.yards_gained
near = (end > 0) & (end <= 5) & (pbp.touchdown != 1) & (pbp.fumble_lost != 1) & (pbp.interception != 1)
rush_nm = pbp[near & (pbp.rush_attempt == 1)].groupby(["game_id", "rusher_player_id"]).size()
rec_nm = pbp[near & (pbp.complete_pass == 1)].groupby(["game_id", "receiver_player_id"]).size()
rush_nm.index.names = rec_nm.index.names = ["game_id", "player_id"]
near_miss = pd.concat([rush_nm, rec_nm], axis=1).fillna(0).sum(axis=1).rename("near_miss").reset_index()

drives = pbp.dropna(subset=["fixed_drive"]).groupby(["game_id", "posteam", "fixed_drive"]).agg(
    min_yl=("yardline_100", "min"), result=("fixed_drive_result", "first"), yards=("yards_gained", "sum"))
drives = drives.reset_index()
drives["rz"] = drives.min_yl <= 20
drives["rz_td"] = drives.rz & (drives.result == "Touchdown")
team_off = drives.groupby(["game_id", "posteam"]).agg(rz=("rz", "sum"), rz_td=("rz_td", "sum"),
                                                       yards=("yards", "sum")).reset_index()
team_off = team_off.rename(columns={"posteam": "team"})

# ---------------------------------------------------------------- player picks
td = pd.read_parquet(TD_PATH)
td = td[(td.prior_games >= 1) & td.implied.notna() & (td.upcoming == 0)].copy()
for p in ["QB", "RB", "WR", "TE"]:
    td[f"pos_{p}"] = (td.position == p).astype(int)

# Need every played game (not just ones in td) to build prior near-miss windows.
allp = pd.read_parquet(TD_PATH, columns=["player_id", "game_id", "kickoff_order", "upcoming", "rz20_tgt", "rz20_car",
                                         "rz10_tgt", "rz10_car", "rz5_tgt", "rz5_car", "tds"])
allp = allp[allp.upcoming == 0].merge(near_miss, on=["game_id", "player_id"], how="left").fillna({"near_miss": 0})
allp = allp.sort_values(["player_id", "kickoff_order"])
allp["nm_last"] = allp.groupby("player_id").near_miss.shift(1)
allp["nm_l3"] = allp.groupby("player_id").near_miss.transform(lambda x: x.shift(1).rolling(3, min_periods=1).sum())
td = td.merge(allp[["player_id", "game_id", "nm_last", "nm_l3"]], on=["player_id", "game_id"], how="left")

XTD_COLS = ["rz20_tgt", "rz20_car", "rz10_tgt", "rz10_car", "rz5_tgt", "rz5_car"]
L8 = [f"l8_{c}" for c in XTD_COLS]
VENOM_PARTS = ["rz_opps8", "gl_opps8", "tgt_share8", "car_share8", "implied", "opp_pos_tds_ratio"]

preds = []
for season in TEST:
    train = td[td.season.between(2020, season - 1)]
    test = td[td.season == season].copy()
    # Gridline live model.
    m = HistGradientBoostingClassifier(max_iter=400, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=80,
                                       l2_regularization=1.0, random_state=7)
    test["gridline"] = m.fit(train[ALL], train.label).predict_proba(test[ALL])[:, 1]
    test["own_rate"] = test.td_rate_shrunk
    # Venom Score: z-scores standardised on earlier seasons, equal weight.
    mu, sd = train[VENOM_PARTS].mean(), train[VENOM_PARTS].std()
    test["venom_score"] = ((test[VENOM_PARTS].fillna(mu) - mu) / sd).mean(axis=1)
    # Expected TDs per game from red-zone touches, Poisson fit on earlier seasons' single games.
    rows = allp[allp.game_id.str[:4].astype(int).between(2019, season - 1)]
    pr = PoissonRegressor(alpha=1e-4, max_iter=1000).fit(rows[XTD_COLS], rows.tds)
    xtd8 = pr.predict(test[L8].fillna(0).set_axis(XTD_COLS, axis=1))  # model of a game with average l8 usage
    test["due"] = xtd8 - test.l8_tds
    test["due_tag"] = (test.due > 0.15) & (test.rz_opps8 >= 1.5)
    test["due_rank"] = np.where(test.rz_opps8 >= 1.5, test.due, -9)
    test["venom_due"] = np.where(test.due_tag, test.venom_score, -9)
    test["td_watch"] = test.nm_last.fillna(0) + test.nm_l3.fillna(0) / 10 + test.rz_opps8.fillna(0) / 100
    preds.append(test)
pp = pd.concat(preds)

METHODS = {"Gridline TD model (live)": "gridline", "Player's own TD rate": "own_rate", "Venom Score": "venom_score",
           "DUE (opportunity minus TDs)": "due_rank", "Venom Score, DUE-tagged only": "venom_due",
           "Touchdown Watch (near misses last game)": "td_watch"}


def breakeven(rate):
    if not 0 < rate < 1:
        return None
    return round(-100 * rate / (1 - rate)) if rate >= 0.5 else round(100 * (1 - rate) / rate)


players = {}
for label, col in METHODS.items():
    res = {}
    for n in TOP_N:
        top = pp.sort_values(col, ascending=False).groupby(["season", "week"]).head(n)
        by = top.groupby("season").label.agg(["sum", "count"])
        rate = float(top.label.mean())
        late = top[top.season >= 2023]
        res[f"top{n}"] = {"hits": int(top.label.sum()), "picks": int(len(top)), "rate": round(rate, 4),
                          "rate2023on": round(float(late.label.mean()), 4), "breakEvenOdds": breakeven(rate),
                          "bySeason": {int(s): [int(r["sum"]), int(r["count"])] for s, r in by.iterrows()}}
    players[label] = res
# How often a DUE-tagged player scores vs similar-volume players without the tag.
vol = pp[pp.rz_opps8 >= 1.5]
due_check = {"dueTagged": [int(vol[vol.due_tag].label.sum()), int(vol.due_tag.sum())],
             "notTagged": [int(vol[~vol.due_tag].label.sum()), int((~vol.due_tag).sum())],
             "gridlinePredDueTagged": round(float(vol[vol.due_tag].gridline.mean()), 4),
             "gridlinePredNotTagged": round(float(vol[~vol.due_tag].gridline.mean()), 4)}

# ---------------------------------------------------------------- team spread rules
games = pd.read_csv(f"{DATA}/games.csv")
games = games[(games.game_type == "REG") & games.season.isin(SEASONS)].copy()
for c in ("home_team", "away_team"):
    games[c] = games[c].replace(ALIASES)
games["kickoff"] = pd.to_datetime(games.gameday + " " + games.gametime.fillna("13:00"))
long = pd.concat([
    games.assign(team=games.home_team, pts=games.home_score)[["game_id", "season", "kickoff", "team", "pts"]],
    games.assign(team=games.away_team, pts=games.away_score)[["game_id", "season", "kickoff", "team", "pts"]]])
long = long.merge(team_off, on=["game_id", "team"], how="left").sort_values(["team", "kickoff"])
rz_rate = {s: (team_off[team_off.game_id.str[:4].astype(int) < s].rz_td.sum()
               / team_off[team_off.game_id.str[:4].astype(int) < s].rz.sum()) for s in TEST}
rz_rate[2019] = rz_rate[2020] = team_off.rz_td.sum() / team_off.rz.sum()
long["exp_rz_td"] = long.rz * long.season.map(rz_rate)
played = long.pts.notna() & long.yards.notna()
for w in (3, 8):
    g = long[played].groupby("team")
    yards = g.yards.transform(lambda x: x.shift(1).rolling(w, min_periods=w).sum())
    pts = g.pts.transform(lambda x: x.shift(1).rolling(w, min_periods=w).sum())
    gap = g.apply(lambda d: (d.exp_rz_td - d.rz_td).shift(1).rolling(w, min_periods=w).sum() / w,
                  include_groups=False).reset_index(level=0, drop=True)
    long.loc[played, f"ypp{w}"] = yards / pts.clip(lower=1)
    long.loc[played, f"rzgap{w}"] = gap
# Upcoming 2026 games have no stats yet; only played games are graded anyway.

gm = pd.read_parquet(GAMES_PATH)
gm = gm[gm.played & gm.spread_line.notna() & (gm.game_type == "REG")].copy()
n = pd.read_csv(NFELO_PATH)[["game_id", "home_line_open"]]
n["game_id"] = n.game_id.str.replace(r"_(OAK|LAR|SD|STL)(?=_|$)", lambda m: "_" + ALIASES[m.group(1)], regex=True)
gm = gm.merge(n, on="game_id", how="left")
gm["open"] = -gm.home_line_open
feat = [c for c in long.columns if c.startswith(("ypp", "rzgap"))]
h = long[["game_id", "team"] + feat].rename(columns={"team": "home_team", **{c: f"h_{c}" for c in feat}})
a = long[["game_id", "team"] + feat].rename(columns={"team": "away_team", **{c: f"a_{c}" for c in feat}})
gm = gm.merge(h, on=["game_id", "home_team"], how="left").merge(a, on=["game_id", "away_team"], how="left")
gm = gm[gm.season.isin(TEST)]

spread_rules = []
for metric, w, q in itertools.product(["ypp", "rzgap"], [3, 8], [0.5, 0.7, 0.9]):
    diff = gm[f"h_{metric}{w}"] - gm[f"a_{metric}{w}"]   # positive = home is more "due"
    # Threshold from 2019-2020-style spread of the same diff: use earlier seasons only.
    ref = (long[long.season.isin([2019, 2020])].groupby("game_id")[f"{metric}{w}"].agg(lambda x: x.max() - x.min()))
    cut = float(ref.quantile(q))
    sel = gm[diff.abs() >= cut].copy()
    side = np.sign(diff[diff.abs() >= cut])
    rec = {}
    for line, col in (("open", "open"), ("close", "spread_line")):
        r = np.sign(sel.margin - sel[col]) * side
        ok = sel[col].notna()
        by = {int(s): [int((r[ok & (sel.season == s)] > 0).sum()), int((r[ok & (sel.season == s)] < 0).sum())] for s in TEST}
        w_, l_ = int((r[ok] > 0).sum()), int((r[ok] < 0).sum())
        rec[line] = {"record": [w_, l_], "rate": round(w_ / (w_ + l_), 4) if w_ + l_ else None, "bySeason": by}
    spread_rules.append({"rule": f"bet the team more 'due' by {'yards per point' if metric == 'ypp' else 'red-zone TD shortfall'}, "
                                 f"last {w} games, gap in top {round((1 - q) * 100)}%", **rec})

# Coin-flip benchmark: best of 12 rules on ~N bets reached by luck.
rng = np.random.default_rng(7)
sizes = [r["open"]["record"][0] + r["open"]["record"][1] for r in spread_rules]
best = [max(rng.binomial(s, 0.5) / s for s in sizes) for _ in range(4000)]
out = {"players": players, "dueCheck": due_check, "spreadRules": spread_rules,
       "luckyBestOf12": {"median": round(float(np.median(best)), 4), "p95": round(float(np.quantile(best, 0.95)), 4)}}
json.dump(out, open(OUT, "w"), indent=1)
for label, res in players.items():
    print(label)
    for k, v in res.items():
        print(f"  {k}: {v['hits']}/{v['picks']} = {v['rate']:.3f} (2023+: {v['rate2023on']:.3f}) {v['bySeason']}")
print(json.dumps(due_check))
for r in spread_rules:
    print(r["rule"], "| open", r["open"]["record"], r["open"]["rate"], "| close", r["close"]["record"], r["close"]["rate"])
print(out["luckyBestOf12"])
