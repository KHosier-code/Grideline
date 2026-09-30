"""Season-to-date team stats and 1-32 ranks, offense and defense, from play-by-play.

Rank 1 is always the best: most points/yards/EPA on offense, fewest allowed on
defense, fewest sacks and turnovers given up on offense, most forced on defense.

Usage: team_stats.py <data dir> <out.parquet> [season]
"""
import sys
from datetime import date

import numpy as np
import pandas as pd

DATA, OUT = sys.argv[1], sys.argv[2]
today = date.today()
SEASON = int(sys.argv[3]) if len(sys.argv) > 3 else (today.year if today.month >= 3 else today.year - 1)
ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA"}

p = pd.read_parquet(f"{DATA}/pbp_{SEASON}.parquet", columns=[
    "game_id", "season_type", "posteam", "defteam", "play_type", "yards_gained", "epa", "pass", "rush",
    "sack", "interception", "fumble_lost", "down", "third_down_converted", "third_down_failed",
    "fourth_down_converted", "yardline_100", "drive", "touchdown", "td_team", "two_point_attempt"])
p = p[(p.season_type == "REG") & p.posteam.notna()].copy()
for column in ("posteam", "defteam", "td_team"):
    p[column] = p[column].replace(ALIASES)
plays = p[p.play_type.isin(["pass", "run"]) & (p.two_point_attempt != 1)].copy()
plays["pass_epa"] = np.where(plays["pass"] == 1, plays.epa, np.nan)
plays["rush_epa"] = np.where(plays["rush"] == 1, plays.epa, np.nan)
plays["pass_yds"] = np.where(plays["pass"] == 1, plays.yards_gained, 0)
plays["rush_yds"] = np.where(plays["rush"] == 1, plays.yards_gained, 0)
plays["turnover_epa"] = np.where((plays.interception == 1) | (plays.fumble_lost == 1), plays.epa, 0)

# Red-zone trips: drives that reached the opponent's 20; TD when that drive scored an offensive TD.
drives = p[p.drive.notna()].groupby(["game_id", "posteam", "drive"]).agg(
    reached=("yardline_100", lambda s: (s <= 20).any()),
    td=("td_team", lambda s: False)).reset_index()
tds = p[(p.touchdown == 1) & (p.td_team == p.posteam)].groupby(["game_id", "posteam", "drive"]).size().rename("scored")
drives = drives.join(tds, on=["game_id", "posteam", "drive"])
drives["rz_td"] = drives.reached & drives.scored.notna()

games = pd.read_csv(f"{DATA}/games.csv")
games = games[(games.season == SEASON) & (games.game_type == "REG") & games.home_score.notna()]
for side in ("home_team", "away_team"):
    games[side] = games[side].replace(ALIASES)
points = pd.concat([
    games[["game_id", "home_team", "home_score", "away_score"]].set_axis(["game_id", "team", "pf", "pa"], axis=1),
    games[["game_id", "away_team", "away_score", "home_score"]].set_axis(["game_id", "team", "pf", "pa"], axis=1),
])
record = points.assign(w=points.pf > points.pa, l=points.pf < points.pa, t=points.pf == points.pa) \
    .groupby("team")[["w", "l", "t"]].sum().astype(int)


def side_stats(key):
    grouped = plays.groupby(key)
    per_game = plays.groupby([key, "game_id"]).agg(
        yds=("yards_gained", "sum"), pass_yds=("pass_yds", "sum"), rush_yds=("rush_yds", "sum"),
        sacks=("sack", "sum"), ints=("interception", "sum"), fumbles=("fumble_lost", "sum"),
        turnover_epa=("turnover_epa", "sum")).groupby(key).mean()
    third = p[p.down == 3].groupby(key).agg(conv=("third_down_converted", "sum"), fail=("third_down_failed", "sum"))
    rz = drives.rename(columns={"posteam": "team"})
    out = pd.DataFrame({
        "epa_play": grouped.epa.mean(), "epa_pass": grouped.pass_epa.mean(), "epa_rush": grouped.rush_epa.mean(),
    }).join(per_game).join((third.conv / (third.conv + third.fail)).rename("third_down"))
    if key == "posteam":
        trips = rz.groupby("team").agg(trips=("reached", "sum"), tds=("rz_td", "sum"))
    else:
        opp = rz.merge(plays[["game_id", "posteam", "defteam"]].drop_duplicates(), left_on=["game_id", "team"],
                       right_on=["game_id", "posteam"]).groupby("defteam").agg(trips=("reached", "sum"), tds=("rz_td", "sum"))
        trips = opp
    out = out.join((trips.tds / trips.trips.replace(0, np.nan)).rename("red_zone"))
    return out


offense = side_stats("posteam")
defense = side_stats("defteam")
pts = points.groupby("team")[["pf", "pa"]].mean()
offense = offense.join(pts.pf.rename("points"))
defense = defense.join(pts.pa.rename("points"))

# For each metric: is a higher value better for the side it describes?
HIGHER_BETTER_OFFENSE = {"points": True, "yds": True, "pass_yds": True, "rush_yds": True, "epa_play": True,
                         "epa_pass": True, "epa_rush": True, "sacks": False, "ints": False, "fumbles": False,
                         "turnover_epa": True, "third_down": True, "red_zone": True}
rows = []
for team in sorted(offense.index):
    row = {"team": team, "wins": int(record.w.get(team, 0)), "losses": int(record.l.get(team, 0)),
           "ties": int(record.t.get(team, 0)), "games": int(record.loc[team].sum()) if team in record.index else 0}
    for metric, higher in HIGHER_BETTER_OFFENSE.items():
        off_value, def_value = offense.at[team, metric], defense.at[team, metric]
        row[f"off_{metric}"] = None if pd.isna(off_value) else float(off_value)
        row[f"def_{metric}"] = None if pd.isna(def_value) else float(def_value)
        row[f"off_{metric}_rank"] = int(offense[metric].rank(ascending=not higher, method="min")[team])
        # Defense is judged from the other side: allowing less is better, forcing more is better.
        row[f"def_{metric}_rank"] = int(defense[metric].rank(ascending=higher, method="min")[team])
    rows.append(row)
stats = pd.DataFrame(rows)
stats.to_parquet(OUT)
print(SEASON, stats.shape)
print(stats[["team", "wins", "losses", "off_points", "off_points_rank", "def_points", "def_points_rank", "off_epa_play_rank", "def_sacks", "def_sacks_rank"]]
      .sort_values("off_points_rank").head(6).round(2).to_string(index=False))
