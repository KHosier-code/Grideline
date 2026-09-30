"""Builds the weekly usage report: player usage, defense vs position and red zone.

Usage: python weekly_report.py DATA_DIR [OUT.json]

Reads the nflverse files fetch_data.sh downloads and, when GRIDLINE_INGEST_URL
and GRIDLINE_INGEST_TOKEN are set, sends the report to the site. Everything is
observed history from completed regular-season games; nothing here is a
prediction.
"""
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DATA = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else None
POSITIONS = ["QB", "RB", "WR", "TE"]
RECENT = 3       # "Last 3" window for players
DVP_RECENT = 4   # "Last 4" window for defenses

season = max(int(re.search(r"stats_(\d{4})", os.path.basename(path)).group(1)) for path in glob.glob(f"{DATA}/stats_*.parquet"))
stats = pd.read_parquet(f"{DATA}/stats_{season}.parquet")
stats = stats[stats.season_type == "REG"].copy()
pbp = pd.read_parquet(f"{DATA}/pbp_{season}.parquet", columns=[
    "game_id", "week", "season_type", "posteam", "defteam", "drive", "yardline_100", "play_type",
    "pass_attempt", "rush_attempt", "sack", "qb_kneel", "qb_spike", "two_point_attempt",
    "receiver_player_id", "rusher_player_id", "td_team", "touchdown"])
pbp = pbp[(pbp.season_type == "REG") & pbp.posteam.notna()].copy()
through_week = int(stats.week.max()) if len(stats) else 0
if through_week == 0:
    sys.exit("No completed regular-season games yet; nothing to report.")
weeks = sorted(int(w) for w in stats.week.unique())

stats["position"] = stats.position.replace({"FB": "RB", "HB": "RB"})
stats["ppr"] = stats.fantasy_points_ppr.fillna(0)
for col in ["targets", "receptions", "receiving_yards", "receiving_tds", "carries", "rushing_yards",
            "rushing_tds", "passing_yards", "passing_tds", "attempts", "receiving_air_yards"]:
    stats[col] = stats[col].fillna(0)


def rnd(value, digits=2):
    return None if value is None or pd.isna(value) or not np.isfinite(value) else round(float(value), digits)


# --- Red-zone and goal-line opportunities from play-by-play -----------------
plays = pbp[(pbp.qb_kneel != 1) & (pbp.qb_spike != 1) & (pbp.two_point_attempt != 1)]
rz = plays[plays.yardline_100 <= 20]
rz_targets = rz[(rz.pass_attempt == 1) & (rz.sack != 1) & rz.receiver_player_id.notna()]
rz_rushes = rz[(rz.rush_attempt == 1) & rz.rusher_player_id.notna()]


def opp_counts(frame, id_col, name):
    return frame.groupby(["week", "posteam", id_col]).size().rename(name).reset_index().rename(
        columns={id_col: "player_id", "posteam": "team"})


opps = None
for frame, col, name in [
    (rz_targets, "receiver_player_id", "rz_targets"), (rz_rushes, "rusher_player_id", "rz_carries"),
    (rz_targets[rz_targets.yardline_100 <= 10], "receiver_player_id", "i10_targets"),
    (rz_rushes[rz_rushes.yardline_100 <= 10], "rusher_player_id", "i10_carries"),
    (rz_rushes[rz_rushes.yardline_100 <= 5], "rusher_player_id", "i5_carries"),
]:
    counts = opp_counts(frame, col, name)
    opps = counts if opps is None else opps.merge(counts, on=["week", "team", "player_id"], how="outer")
opps = opps.fillna(0)
stats = stats.merge(opps, on=["week", "team", "player_id"], how="left")
for col in ["rz_targets", "rz_carries", "i10_targets", "i10_carries", "i5_carries"]:
    stats[col] = stats[col].fillna(0)
stats["rz_opps"] = stats.rz_targets + stats.rz_carries
stats["i10_opps"] = stats.i10_targets + stats.i10_carries

# Team totals per game, the denominators for shares.
team_week = stats.groupby(["team", "week"]).agg(
    team_targets=("targets", "sum"), team_carries=("carries", "sum"),
    team_air=("receiving_air_yards", "sum"), team_rz=("rz_opps", "sum")).reset_index()
stats = stats.merge(team_week, on=["team", "week"], how="left")


def share(num, den):
    return rnd(num / den, 3) if den > 0 else None


def player_window(rows):
    games = len(rows)
    t = rows.sum(numeric_only=True)
    return {
        "games": games,
        "targetsPerGame": rnd(t.targets / games, 1),
        "targetShare": share(t.targets, t.team_targets),
        "airYardsShare": share(max(t.receiving_air_yards, 0), t.team_air) if t.team_air > 0 else None,
        "receptionsPerGame": rnd(t.receptions / games, 1),
        "receivingYardsPerGame": rnd(t.receiving_yards / games, 1),
        "carriesPerGame": rnd(t.carries / games, 1),
        "carryShare": share(t.carries, t.team_carries),
        "rushingYardsPerGame": rnd(t.rushing_yards / games, 1),
        "passingYardsPerGame": rnd(t.passing_yards / games, 1),
        "redZoneOppsPerGame": rnd(t.rz_opps / games, 2),
        "redZoneShare": share(t.rz_opps, t.team_rz),
        "inside10OppsPerGame": rnd(t.i10_opps / games, 2),
        "touchdowns": int(t.receiving_tds + t.rushing_tds + (t.passing_tds if rows.position.iloc[0] == "QB" else 0)),
        "pprPerGame": rnd(t.ppr / games, 1),
    }


players = []
for (player_id, team), rows in stats[stats.position.isin(POSITIONS)].groupby(["player_id", "team"]):
    rows = rows.sort_values("week")
    if rows.targets.sum() + rows.carries.sum() + rows.attempts.sum() == 0:
        continue
    last = rows.iloc[-1]
    players.append({
        "playerId": player_id,
        "name": last.player_display_name,
        "position": last.position,
        "team": team,
        "headshot": last.headshot_url if isinstance(last.headshot_url, str) else None,
        "lastWeek": int(last.week),
        "season": player_window(rows),
        "last3": player_window(rows.tail(RECENT)),
        "weekly": [{
            "week": int(r.week), "opponent": r.opponent_team,
            "targets": int(r.targets), "carries": int(r.carries), "redZoneOpps": int(r.rz_opps),
            "targetShare": share(r.targets, r.team_targets), "carryShare": share(r.carries, r.team_carries),
            "touchdowns": int(r.receiving_tds + r.rushing_tds), "ppr": rnd(r.ppr, 1),
        } for r in rows.itertuples()],
    })

# --- Defense vs position ------------------------------------------------------
pos_week = stats[stats.position.isin(POSITIONS)].copy()
pos_week["yards"] = np.where(pos_week.position == "QB",
                             pos_week.passing_yards + pos_week.rushing_yards,
                             pos_week.receiving_yards + pos_week.rushing_yards)
pos_week["tds"] = np.where(pos_week.position == "QB",
                           pos_week.passing_tds + pos_week.rushing_tds,
                           pos_week.receiving_tds + pos_week.rushing_tds)
allowed = pos_week.groupby(["opponent_team", "position", "week"]).agg(
    ppr=("ppr", "sum"), yards=("yards", "sum"), tds=("tds", "sum"),
    receptions=("receptions", "sum"), targets=("targets", "sum"),
    rz_opps=("rz_opps", "sum")).reset_index().rename(columns={"opponent_team": "defense"})
metrics = ["ppr", "yards", "tds", "receptions", "targets", "rz_opps"]


def dvp_window(frame, recent=None):
    frame = frame.sort_values("week")
    if recent:
        frame = frame.groupby(["defense", "position"]).tail(recent)
    grouped = frame.groupby(["defense", "position"])
    out = grouped[metrics].mean()
    out["games"] = grouped.size()
    return out.reset_index()


defense_rows = []
for window, frame in [("season", dvp_window(allowed)), ("last4", dvp_window(allowed, DVP_RECENT))]:
    for position in POSITIONS:
        part = frame[frame.position == position].copy()
        league = part.ppr.mean()
        for metric in metrics:
            # Rank 1 = allows the most = the easiest matchup for that position.
            part[f"{metric}_rank"] = part[metric].rank(ascending=False, method="min")
        for r in part.itertuples():
            defense_rows.append((r.defense, window, position, {
                "games": int(r.games),
                "pprPerGame": rnd(r.ppr, 1), "pprRank": int(r.ppr_rank),
                "vsAverage": rnd(r.ppr / league - 1, 3) if league else None,
                "yardsPerGame": rnd(r.yards, 1), "yardsRank": int(r.yards_rank),
                "tdsPerGame": rnd(r.tds, 2), "tdsRank": int(r.tds_rank),
                "receptionsPerGame": rnd(r.receptions, 1), "receptionsRank": int(r.receptions_rank),
                "targetsPerGame": rnd(r.targets, 1), "targetsRank": int(r.targets_rank),
                "redZoneOppsPerGame": rnd(r.rz_opps, 2), "redZoneOppsRank": int(r.rz_opps_rank),
            }))
defenses = {}
for team, window, position, row in defense_rows:
    defenses.setdefault(team, {"team": team, "season": {}, "last4": {}})[window][position] = row

# --- Team red zone ------------------------------------------------------------
drives = plays[plays.drive.notna()].copy()
drives["in_rz"] = drives.yardline_100 <= 20
drives["off_td"] = (drives.touchdown == 1) & (drives.td_team == drives.posteam)
per_drive = drives.groupby(["game_id", "posteam", "defteam", "drive"]).agg(
    in_rz=("in_rz", "max"), td=("off_td", "max")).reset_index()
trips = per_drive[per_drive.in_rz]
games_played = plays.groupby("posteam").game_id.nunique()
off = trips.groupby("posteam").agg(trips=("in_rz", "size"), tds=("td", "sum"))
dfn = trips.groupby("defteam").agg(trips=("in_rz", "size"), tds=("td", "sum"))
rz_plays = rz.groupby("posteam").agg(passes=("pass_attempt", "sum"), rushes=("rush_attempt", "sum"))
red_zone_teams = []
for team in sorted(games_played.index):
    g = int(games_played[team])
    o = off.loc[team] if team in off.index else pd.Series({"trips": 0, "tds": 0})
    d = dfn.loc[team] if team in dfn.index else pd.Series({"trips": 0, "tds": 0})
    p = rz_plays.loc[team] if team in rz_plays.index else pd.Series({"passes": 0, "rushes": 0})
    red_zone_teams.append({
        "team": team, "games": g,
        "tripsPerGame": rnd(o.trips / g, 2), "tdRate": share(o.tds, o.trips),
        "touchdowns": int(o.tds), "trips": int(o.trips),
        "passRate": share(p.passes, p.passes + p.rushes),
        "allowedTripsPerGame": rnd(d.trips / g, 2), "allowedTdRate": share(d.tds, d.trips),
    })
rz_frame = pd.DataFrame(red_zone_teams)
for col, ascending in [("tripsPerGame", False), ("tdRate", False), ("allowedTripsPerGame", True), ("allowedTdRate", True)]:
    ranks = rz_frame[col].rank(ascending=ascending, method="min")
    for row, rank in zip(red_zone_teams, ranks):
        row[f"{col}Rank"] = None if pd.isna(rank) else int(rank)

report = {
    "season": season,
    "throughWeek": through_week,
    "weeks": weeks,
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": "nflverse play-by-play and weekly player stats, regular season",
    "players": players,
    "defenses": sorted(defenses.values(), key=lambda d: d["team"]),
    "redZoneTeams": red_zone_teams,
}
body = json.dumps({"kind": "usage", "season": season, "week": through_week,
                   "generatedAt": report["generatedAt"], "payload": report}).encode()
print(f"{season} through week {through_week}: {len(players)} players, {len(defenses)} defenses, "
      f"{len(red_zone_teams)} teams; {len(body) / 1024:.0f} KB")
if OUT:
    json.dump(report, open(OUT, "w"), indent=1)

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
    sys.exit(0)
request = urllib.request.Request(f"{origin.rstrip('/')}/api/reports/ingest", data=body, method="POST", headers={
    "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "gridline-weekly-report"})
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("Sent:", response.status, response.read().decode()[:200])
except urllib.error.HTTPError as error:
    print(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
    sys.exit(1)
