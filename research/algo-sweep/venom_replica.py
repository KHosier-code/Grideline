"""Rebuild of Venom Analytics' published NFL anytime-TD score, backtested 2021 through 2026 week 3.

Venom's "NFL Metrics Explained" page (screenshots Kalen shared on 2026-10-01)
gives the recipe. Everything is computed over the player's last five
meaningful games, re-scored every week, on a 1-100 scale:

  Venom Score = baseline x 0.60 + opportunity x 0.40 + due bonus
  Baseline    = red-zone role 35% (share of team red-zone touches), volume 25%
                (touches per game), goal line 15% (carries inside the 5),
                target share 15%, TD rate 10% (TDs per touch)
  Opportunity = implied team total 55%, matchup 45% (TDs the opponent allows
                per game to his position)
  Due bonus   = elite red-zone role + 3 straight games without a TD: +8;
                12+ touches a game + 4 straight games without a TD: +5
  TD debt     = every touch priced at the league's TD rate from that spot
                (goal line, red zone, fringe, open field; rush or target),
                expected minus actual TDs. Positive = "Due For TD", negative =
                "Regression Risk".

Choices the page leaves open, picked here and varied where it matters:
  - 1-100 scale: each metric is a percentile rank among that week's board
    (every QB/RB/WR/TE with a prior game), as is each sub-score.
  - "Meaningful game": at least one carry or target. Windows carry across seasons.
  - "Elite red-zone role": top 10% of the week's board in red-zone share.
  - Zones: goal line inside the 5, red zone 6-20, fringe 21-30, open field 31+.
    Conversion rates come from seasons before the one being scored.
  - Matchup uses the opponent's last five games.
  - The two due bonuses don't stack (the larger applies).
  - Score-to-probability: logistic fit on earlier seasons.
Lines are the closing spread/total from nflverse (Venom would see the current
line), the same input the Gridline TD model uses.

The Box Count and Coverage Shell clones feed Venom's rushing-yards and
receptions packs, not the anytime-TD score, so they are not rebuilt here.

Grading matches td_backtest.py: a pick hits if the player scores a rushing or
receiving TD; players who didn't play are void.

Usage: venom_replica.py <data dir> <td_dataset.parquet> <games.parquet> <nfelo_games.csv> <out.json>
"""
import itertools
import json
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, __file__.rsplit("/", 2)[0] + "/td-model")
from features import ALL  # noqa: E402

DATA, TD_PATH, GAMES_PATH, NFELO_PATH, OUT = sys.argv[1:6]
SEASONS = list(range(2019, 2027))
SCORED = list(range(2020, 2027))   # 2020 is scored too, so 2021's calibration has a season to fit on
TEST = list(range(2021, 2027))
TOP_N = [1, 3, 5, 10]
ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA"}
POSITIONS = ["QB", "RB", "WR", "TE"]

# ---------------------------------------------------------------- plays: one row per carry or target
frames = []
for s in SEASONS:
    p = pd.read_parquet(f"{DATA}/pbp_{s}.parquet", columns=[
        "game_id", "season_type", "posteam", "defteam", "yardline_100", "rush_attempt", "pass_attempt",
        "rusher_player_id", "receiver_player_id", "touchdown", "td_player_id", "two_point_attempt",
        "qb_kneel", "qb_spike", "play_type"])
    p = p[(p.season_type == "REG") & p.play_type.isin(["pass", "run"]) & (p.two_point_attempt != 1)
          & (p.qb_kneel != 1) & (p.qb_spike != 1) & p.yardline_100.notna()]
    p = p.assign(season=s)
    rush = p[(p.rush_attempt == 1) & p.rusher_player_id.notna()].assign(player_id=lambda d: d.rusher_player_id, kind="rush")
    tgt = p[(p.pass_attempt == 1) & p.receiver_player_id.notna()].assign(player_id=lambda d: d.receiver_player_id, kind="target")
    frames.append(pd.concat([rush, tgt]))
plays = pd.concat(frames, ignore_index=True)
for c in ("posteam", "defteam"):
    plays[c] = plays[c].replace(ALIASES)
plays["td"] = ((plays.touchdown == 1) & (plays.td_player_id == plays.player_id)).astype(int)
plays["zone"] = pd.cut(plays.yardline_100, [0, 5, 20, 30, 100], labels=["goal line", "red zone", "fringe", "open field"])
plays["rz"] = (plays.yardline_100 <= 20).astype(int)
plays["gl_carry"] = ((plays.yardline_100 <= 5) & (plays.kind == "rush")).astype(int)
plays["is_target"] = (plays.kind == "target").astype(int)

# League TD rate by zone and play type, from seasons before the one being scored.
rate_by_season = {s: plays[plays.season < s].groupby(["zone", "kind"], observed=True).td.mean() for s in SCORED}
rate_by_season[2019] = plays[plays.season == 2019].groupby(["zone", "kind"], observed=True).td.mean()  # warm-up only
plays["xtd"] = [rate_by_season[s].get((z, k), 0.0) for s, z, k in zip(plays.season, plays.zone, plays.kind)]

pg = plays.groupby(["game_id", "player_id"]).agg(
    team=("posteam", "first"), opps=("td", "size"), rz=("rz", "sum"), gl=("gl_carry", "sum"),
    targets=("is_target", "sum"), xtd=("xtd", "sum"), pbp_td=("td", "sum")).reset_index()
team_g = plays.groupby(["game_id", "posteam"]).agg(team_rz=("rz", "sum"), team_targets=("is_target", "sum"),
                                                     team_xtd=("xtd", "sum"), team_td=("td", "sum")).reset_index()
pg = pg.merge(team_g.rename(columns={"posteam": "team"}), on=["game_id", "team"], how="left")

# ---------------------------------------------------------------- player stats and the last five meaningful games
stats = []
for s in SEASONS:
    st = pd.read_parquet(f"{DATA}/stats_{s}.parquet")
    stats.append(st[(st.season_type == "REG") & st.position.isin(POSITIONS)][
        ["player_id", "position", "season", "week", "game_id", "team", "opponent_team", "carries", "receptions",
         "rushing_tds", "receiving_tds"]])
stats = pd.concat(stats, ignore_index=True).fillna({"carries": 0, "receptions": 0, "rushing_tds": 0, "receiving_tds": 0})
stats["team"] = stats.team.replace(ALIASES)
stats["opponent_team"] = stats.opponent_team.replace(ALIASES)
stats["tds"] = stats.rushing_tds + stats.receiving_tds
stats["touches"] = stats.carries + stats.receptions

games = pd.read_csv(f"{DATA}/games.csv")[["game_id", "gameday", "gametime"]]
games["kickoff"] = pd.to_datetime(games.gameday + " " + games.gametime.fillna("13:00"))
hist = stats.merge(pg.drop(columns="team"), on=["game_id", "player_id"], how="left").merge(
    games[["game_id", "kickoff"]], on="game_id")
hist[["opps", "rz", "gl", "targets", "xtd", "team_rz", "team_targets"]] = hist[
    ["opps", "rz", "gl", "targets", "xtd", "team_rz", "team_targets"]].fillna(0)
mean = hist[hist.opps >= 1].sort_values(["player_id", "kickoff"]).copy()   # meaningful games only
g = mean.groupby("player_id")
for col in ["rz", "team_rz", "touches", "gl", "targets", "team_targets", "tds", "xtd"]:
    mean[f"w_{col}"] = g[col].transform(lambda x: x.rolling(5, min_periods=1).sum())
mean["w_n"] = g.tds.transform(lambda x: x.rolling(5, min_periods=1).count())
mean["max_td3"] = g.tds.transform(lambda x: x.rolling(3, min_periods=3).max())
mean["max_td4"] = g.tds.transform(lambda x: x.rolling(4, min_periods=4).max())
window = mean[["player_id", "kickoff"] + [c for c in mean.columns if c.startswith(("w_", "max_td"))]]

# Opponent TDs allowed per game to each position, its last five games.
allowed = stats.groupby(["game_id", "opponent_team", "position"]).tds.sum().unstack(fill_value=0).stack().rename("allowed")
allowed = allowed.reset_index().rename(columns={"opponent_team": "defense"}).merge(games[["game_id", "kickoff"]], on="game_id")
allowed = allowed.sort_values(["defense", "position", "kickoff"])
allowed["opp_allowed5"] = allowed.groupby(["defense", "position"]).allowed.transform(
    lambda x: x.rolling(5, min_periods=1).mean())

# ---------------------------------------------------------------- the board: rows to score
td = pd.read_parquet(TD_PATH)
td = td[(td.prior_games >= 1) & td.implied.notna() & (td.upcoming == 0) & td.season.isin(SCORED)].copy()
td["team"] = td.team.replace(ALIASES)
td["opponent"] = td.opponent.replace(ALIASES)
for p in POSITIONS:
    td[f"pos_{p}"] = (td.position == p).astype(int)
td = td.sort_values("kickoff_order")
td = pd.merge_asof(td, window.sort_values("kickoff"), left_on="kickoff_order", right_on="kickoff", by="player_id",
                   allow_exact_matches=False)
al = allowed.rename(columns={"defense": "opponent"})[["opponent", "position", "kickoff", "opp_allowed5"]].sort_values("kickoff")
td = pd.merge_asof(td.drop(columns="kickoff"), al, left_on="kickoff_order", right_on="kickoff",
                   by=["opponent", "position"], allow_exact_matches=False)
td = td[td.w_n.notna()].copy()

td["rz_share"] = td.w_rz / td.w_team_rz.replace(0, np.nan)
td["volume"] = td.w_touches / td.w_n
td["goal_line"] = td.w_gl / td.w_n
td["tgt_share"] = td.w_targets / td.w_team_targets.replace(0, np.nan)
td["td_rate"] = td.w_tds / td.w_touches.replace(0, np.nan)
td["td_debt"] = td.w_xtd - td.w_tds
td[["rz_share", "tgt_share", "td_rate", "opp_allowed5"]] = td[["rz_share", "tgt_share", "td_rate", "opp_allowed5"]].fillna(0)

wk = td.groupby(["season", "week"])


def pct(col):
    return wk[col].rank(pct=True) * 100


BASE = {"rz_share": .35, "volume": .25, "goal_line": .15, "tgt_share": .15, "td_rate": .10}
OPP = {"implied": .55, "opp_allowed5": .45}
td["baseline"] = sum(w * pct(c) for c, w in BASE.items())
td["opportunity"] = sum(w * pct(c) for c, w in OPP.items())
td["baseline"] = pct("baseline")
td["opportunity"] = pct("opportunity")
elite = pct("rz_share") >= 90
bonus8 = elite & (td.max_td3 == 0)
bonus5 = (td.volume >= 12) & (td.max_td4 == 0)
td["due_bonus"] = np.where(bonus8, 8, np.where(bonus5, 5, 0))
td["venom"] = (0.6 * td.baseline + 0.4 * td.opportunity + td.due_bonus).clip(1, 100)
td["venom_no_bonus"] = (0.6 * td.baseline + 0.4 * td.opportunity).clip(1, 100)
# Variant: raw-value z-scores instead of percentile ranks (in case Venom scales that way).
z = lambda c: (td[c] - wk[c].transform("mean")) / wk[c].transform("std")  # noqa: E731
td["venom_z"] = (0.6 * sum(w * z(c) for c, w in BASE.items()) + 0.4 * sum(w * z(c) for c, w in OPP.items())
                 + td.due_bonus / 25)
td["due_tag"] = td.td_debt >= 0.75
td["regression_tag"] = td.td_debt <= -0.75

# ---------------------------------------------------------------- walk-forward: Gridline model and Venom calibration
parts = []
for season in TEST:
    train = td[td.season.between(2020, season - 1)]
    test = td[td.season == season].copy()
    hgb = HistGradientBoostingClassifier(max_iter=400, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=80,
                                         l2_regularization=1.0, random_state=7)
    # Gridline model trains on all its usual rows, not only rows Venom can score.
    full = pd.read_parquet(TD_PATH)
    full = full[(full.prior_games >= 1) & full.implied.notna() & (full.upcoming == 0) & full.season.between(2020, season - 1)]
    for p in POSITIONS:
        full[f"pos_{p}"] = (full.position == p).astype(int)
    test["gridline"] = hgb.fit(full[ALL], full.label).predict_proba(test[ALL])[:, 1]
    cal = LogisticRegression().fit(train[["venom"]], train.label)
    test["venom_prob"] = cal.predict_proba(test[["venom"]])[:, 1]
    # Does TD debt add anything once the Gridline model's chance is known? Fit on earlier seasons.
    parts.append(test)
pp = pd.concat(parts)


def breakeven(rate):
    if not 0 < rate < 1:
        return None
    return round(-100 * rate / (1 - rate)) if rate >= 0.5 else round(100 * (1 - rate) / rate)


def top_record(frame, col):
    res = {}
    for n in TOP_N:
        top = frame.sort_values(col, ascending=False).groupby(["season", "week"]).head(n)
        late = top[top.season >= 2023]
        by = top.groupby("season").label.agg(["sum", "count"])
        res[f"top{n}"] = {"hits": int(top.label.sum()), "picks": int(len(top)), "rate": round(float(top.label.mean()), 4),
                          "hits2023on": int(late.label.sum()), "picks2023on": int(len(late)),
                          "rate2023on": round(float(late.label.mean()), 4), "breakEvenOdds": breakeven(float(top.label.mean())),
                          "bySeason": {int(s): [int(r["sum"]), int(r["count"])] for s, r in by.iterrows()}}
    return res


METHODS = {"Venom Score (as published)": ("venom", pp),
           "Venom Score without the due bonus": ("venom_no_bonus", pp),
           "Venom Score, z-score scaling": ("venom_z", pp),
           "Venom Score, no QBs": ("venom", pp[pp.position != "QB"]),
           "Gridline TD model (live)": ("gridline", pp),
           "Gridline TD model, no QBs": ("gridline", pp[pp.position != "QB"])}
players = {k: top_record(f, c) for k, (c, f) in METHODS.items()}

# Overlap: how many of Venom's weekly top 5 are also in Gridline's top 5.
v5 = pp.sort_values("venom", ascending=False).groupby(["season", "week"]).head(5)
g5 = pp.sort_values("gridline", ascending=False).groupby(["season", "week"]).head(5)
overlap = len(v5.merge(g5, on=["player_id", "game_id"])) / len(v5)


def calib(col):
    bins = pd.cut(pp[col], [0, .1, .2, .3, .4, .5, .6, 1])
    return [{"bin": str(b), "n": int(len(x)), "predicted": round(float(x[col].mean()), 4), "actual": round(float(x.label.mean()), 4)}
            for b, x in pp.groupby(bins, observed=True)]


brier = {c: round(float(((pp[c] - pp.label) ** 2).mean()), 5) for c in ("venom_prob", "gridline")}


def tag_check(mask):
    x = pp[mask]
    return {"players": int(len(x)), "scored": round(float(x.label.mean()), 4),
            "gridlineExpected": round(float(x.gridline.mean()), 4), "venomExpected": round(float(x.venom_prob.mean()), 4)}


tags = {"Due For TD (debt >= 0.75)": tag_check(pp.due_tag),
        "Regression Risk (debt <= -0.75)": tag_check(pp.regression_tag),
        "No debt tag": tag_check(~pp.due_tag & ~pp.regression_tag),
        "Due bonus +8 fired": tag_check(pp.due_bonus == 8),
        "Due bonus +5 fired": tag_check(pp.due_bonus == 5)}
# Within the Venom top 10, does a Due For TD tag help or hurt?
v10 = pp.sort_values("venom", ascending=False).groupby(["season", "week"]).head(10)
tags["Venom top 10 with Due For TD"] = {"players": int(v10.due_tag.sum()), "scored": round(float(v10[v10.due_tag].label.mean()), 4)}
tags["Venom top 10 without it"] = {"players": int((~v10.due_tag).sum()), "scored": round(float(v10[~v10.due_tag].label.mean()), 4)}

# ---------------------------------------------------------------- team TD debt against the spread
sched = pd.read_csv(f"{DATA}/games.csv")
sched = sched[(sched.game_type == "REG") & sched.season.isin(SEASONS)]
team_g = team_g.merge(games[["game_id", "kickoff"]], on="game_id")
team_g["off_debt"] = team_g.team_xtd - team_g.team_td
d = plays.groupby(["game_id", "defteam"]).agg(def_xtd=("xtd", "sum"), def_td=("td", "sum")).reset_index()
team_g = team_g.merge(d.rename(columns={"defteam": "opp_def"}), on="game_id")
team_g = team_g[team_g.opp_def != team_g.posteam]
team_g["def_debt"] = team_g.def_xtd - team_g.def_td      # TDs this defense "should" have allowed but didn't
team_g = team_g.sort_values(["posteam", "kickoff"])
for c in ("off_debt",):
    team_g[f"{c}5"] = team_g.groupby("posteam")[c].transform(lambda x: x.shift(1).rolling(5, min_periods=3).sum())
dd = team_g[["game_id", "opp_def", "kickoff", "def_debt"]].sort_values(["opp_def", "kickoff"])
dd["def_debt5"] = dd.groupby("opp_def").def_debt.transform(lambda x: x.shift(1).rolling(5, min_periods=3).sum())
tf = team_g[["game_id", "posteam", "off_debt5"]].rename(columns={"posteam": "team"}).merge(
    dd[["game_id", "opp_def", "def_debt5"]].rename(columns={"opp_def": "team"}), on=["game_id", "team"])

gm = pd.read_parquet(GAMES_PATH)
gm = gm[gm.played & gm.spread_line.notna() & (gm.game_type == "REG")].copy()
nf = pd.read_csv(NFELO_PATH)[["game_id", "home_line_open"]]
nf["game_id"] = nf.game_id.str.replace(r"_(OAK|LAR|SD|STL)(?=_|$)", lambda m: "_" + ALIASES[m.group(1)], regex=True)
gm = gm.merge(nf, on="game_id", how="left")
gm["open"] = -gm.home_line_open
gm = gm.merge(tf.add_prefix("h_").rename(columns={"h_game_id": "game_id", "h_team": "home_team"}), on=["game_id", "home_team"], how="left")
gm = gm.merge(tf.add_prefix("a_").rename(columns={"a_game_id": "game_id", "a_team": "away_team"}), on=["game_id", "away_team"], how="left")
# Positive = home side more "due": its offense owes TDs, or the away defense owes TDs allowed.
gm["off_diff"] = gm.h_off_debt5 - gm.a_off_debt5
gm["all_diff"] = (gm.h_off_debt5 + gm.a_def_debt5) - (gm.a_off_debt5 + gm.h_def_debt5)

spread_rules = []
for diffcol, q in itertools.product(["off_diff", "all_diff"], [0.5, 0.7, 0.9]):
    cut = float(gm[gm.season.isin([2019, 2020])][diffcol].abs().quantile(q))
    sel = gm[gm.season.isin(TEST) & (gm[diffcol].abs() >= cut)]
    side = np.sign(sel[diffcol])
    rec = {}
    for line, col in (("open", "open"), ("close", "spread_line")):
        r = (np.sign(sel.margin - sel[col]) * side)[sel[col].notna()]
        s_ = sel[sel[col].notna()].season
        rec[line] = {"record": [int((r > 0).sum()), int((r < 0).sum())],
                     "rate": round(float((r > 0).sum() / ((r > 0).sum() + (r < 0).sum())), 4),
                     "bySeason": {int(s): [int((r[s_ == s] > 0).sum()), int((r[s_ == s] < 0).sum())] for s in TEST}}
    spread_rules.append({"rule": f"bet the team more in TD debt ({'offense only' if diffcol == 'off_diff' else 'offense + opposing defense'}), "
                                 f"last 5 games, gap in top {round((1 - q) * 100)}%", **rec})

out = {"players": players, "top5OverlapWithGridline": round(overlap, 3), "calibration": {"venom": calib("venom_prob"), "gridline": calib("gridline")},
       "brier": brier, "tags": tags, "spreadRules": spread_rules, "boardRows": int(len(pp))}
json.dump(out, open(OUT, "w"), indent=1)
for k, res in players.items():
    print(k)
    for n, v in res.items():
        print(f"  {n}: {v['hits']}/{v['picks']} = {v['rate']:.3f} | 2023+: {v['hits2023on']}/{v['picks2023on']} = {v['rate2023on']:.3f} | {v['bySeason']}")
print("top5 overlap", round(overlap, 3), "brier", brier)
print(json.dumps(tags, indent=0))
for r in spread_rules:
    print(r["rule"], "| open", r["open"]["record"], r["open"]["rate"], "| close", r["close"]["record"], r["close"]["rate"])
