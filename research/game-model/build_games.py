"""One row per game with pregame features: team efficiency, starting QB, rest,
weather, venue and the closing market line. Everything is computed from games
played strictly before the one being described.

Usage: build_games.py <data dir> <out.parquet>
"""
import sys
from datetime import date

import numpy as np
import pandas as pd

DATA, OUT = sys.argv[1], sys.argv[2]
CURRENT_SEASON = date.today().year if date.today().month >= 3 else date.today().year - 1
SEASONS = list(range(2019, CURRENT_SEASON + 1))
HALF_LIFE_GAMES = 6          # weight halves every 6 games
SEASON_CARRYOVER = 0.5       # last season's games count half at the new season
QB_PRIOR_DROPBACKS = 150     # shrink small samples toward replacement level
QB_REPLACEMENT_EPA = -0.08   # typical backup EPA per dropback
TEAM_ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA"}

# ---------------------------------------------------------------- schedule
games = pd.read_csv(f"{DATA}/games.csv")
games = games[games.season.isin(SEASONS)].copy()
for side in ("home_team", "away_team"):
    games[side] = games[side].replace(TEAM_ALIASES)
games["kickoff"] = pd.to_datetime(games.gameday + " " + games.gametime.fillna("13:00"))
games = games.sort_values(["kickoff", "game_id"]).reset_index(drop=True)
games["played"] = games.home_score.notna() & games.away_score.notna()

# ---------------------------------------------------------------- play-by-play aggregates
team_rows, qb_rows = [], []
for season in SEASONS:
    try:
        p = pd.read_parquet(f"{DATA}/pbp_{season}.parquet", columns=[
            "game_id", "posteam", "defteam", "play_type", "epa", "success", "pass", "rush", "qb_dropback",
            "qb_epa", "cpoe", "id", "two_point_attempt", "qb_kneel", "qb_spike"])
    except FileNotFoundError:
        continue
    p = p[p.play_type.isin(["pass", "run"]) & p.epa.notna() & (p.two_point_attempt != 1)
          & (p.qb_kneel != 1) & (p.qb_spike != 1)].copy()
    p["posteam"] = p.posteam.replace(TEAM_ALIASES)
    p["defteam"] = p.defteam.replace(TEAM_ALIASES)
    p["pass_epa"] = np.where(p["pass"] == 1, p.epa, np.nan)
    p["rush_epa"] = np.where(p["rush"] == 1, p.epa, np.nan)
    agg = p.groupby(["game_id", "posteam", "defteam"]).agg(
        plays=("epa", "size"), epa=("epa", "mean"), success=("success", "mean"),
        pass_epa=("pass_epa", "mean"), rush_epa=("rush_epa", "mean")).reset_index()
    team_rows.append(agg)
    qb = p[(p.qb_dropback == 1) & p.id.notna()].groupby(["game_id", "posteam", "id"]).agg(
        dropbacks=("qb_epa", "size"), qb_epa=("qb_epa", "sum"), cpoe=("cpoe", "mean")).reset_index()
    qb_rows.append(qb)
team_games = pd.concat(team_rows, ignore_index=True)
qb_games = pd.concat(qb_rows, ignore_index=True)

order = games.set_index("game_id")[["kickoff", "season"]]
team_games = team_games.join(order, on="game_id").dropna(subset=["kickoff"])
qb_games = qb_games.join(order, on="game_id").dropna(subset=["kickoff"])


def decayed_mean(values, weights):
    mask = ~np.isnan(values)
    return float(np.sum(values[mask] * weights[mask]) / np.sum(weights[mask])) if mask.any() else np.nan


def weights_for(frame, target_season):
    n = len(frame)
    w = 0.5 ** (np.arange(n)[::-1] / HALF_LIFE_GAMES)
    return w * np.where(frame.season.values < target_season, SEASON_CARRYOVER, 1.0)


# Team offense (as posteam) and defense (as defteam) histories, sorted by time.
offense = {team: frame.sort_values("kickoff") for team, frame in team_games.groupby("posteam")}
defense = {team: frame.sort_values("kickoff") for team, frame in team_games.groupby("defteam")}
qb_hist = {qb: frame.sort_values("kickoff") for qb, frame in qb_games.groupby("id")}
starters = qb_games.sort_values("dropbacks").groupby(["game_id", "posteam"]).tail(1)
starter_by_team = {team: frame.sort_values("kickoff") for team, frame in starters.groupby("posteam")}


def team_features(team, kickoff, season):
    out = {}
    for label, source in (("off", offense), ("def", defense)):
        hist = source.get(team)
        hist = hist[hist.kickoff < kickoff].tail(24) if hist is not None else None
        if hist is None or hist.empty:
            for metric in ("epa", "success", "pass_epa", "rush_epa"):
                out[f"{label}_{metric}"] = np.nan
            out[f"{label}_games"] = 0
            continue
        w = weights_for(hist, season)
        for metric in ("epa", "success", "pass_epa", "rush_epa"):
            out[f"{label}_{metric}"] = decayed_mean(hist[metric].values.astype(float), w)
        out[f"{label}_games"] = int((hist.season == season).sum())
    return out


def qb_features(qb_id, team, kickoff, season):
    """Value of the starting QB and whether he is the team's usual starter."""
    usual = starter_by_team.get(team)
    usual = usual[usual.kickoff < kickoff].tail(4) if usual is not None else None
    usual_id = usual.id.mode().iloc[0] if usual is not None and len(usual) else None
    if not isinstance(qb_id, str) or not qb_id:
        qb_id = usual.id.iloc[-1] if usual is not None and len(usual) else None
    hist = qb_hist.get(qb_id)
    hist = hist[hist.kickoff < kickoff].tail(40) if hist is not None else None
    if hist is None or hist.empty:
        value, dropbacks, cpoe = QB_REPLACEMENT_EPA, 0.0, np.nan
    else:
        w = weights_for(hist, season)
        weighted_db = float(np.sum(hist.dropbacks.values * w))
        weighted_epa = float(np.sum(hist.qb_epa.values * w))
        value = (weighted_epa + QB_REPLACEMENT_EPA * QB_PRIOR_DROPBACKS) / (weighted_db + QB_PRIOR_DROPBACKS)
        dropbacks = float(hist.dropbacks.sum())
        cpoe = decayed_mean(hist.cpoe.values.astype(float), w)
    return {"qb_value": value, "qb_dropbacks": dropbacks, "qb_cpoe": cpoe,
            "qb_new": int(usual_id is not None and qb_id is not None and qb_id != usual_id)}


rows = []
for g in games.itertuples():
    row = {"game_id": g.game_id, "espn": g.espn, "season": g.season, "week": g.week, "game_type": g.game_type,
           "kickoff": g.kickoff, "played": g.played, "home_team": g.home_team, "away_team": g.away_team,
           "home_score": g.home_score, "away_score": g.away_score, "spread_line": g.spread_line,
           "total_line": g.total_line, "home_moneyline": g.home_moneyline, "away_moneyline": g.away_moneyline,
           "neutral": int(g.location == "Neutral"), "div_game": g.div_game, "rest_diff": (g.home_rest or 7) - (g.away_rest or 7),
           "dome": int(g.roof in ("dome", "closed")), "wind": g.wind if pd.notna(g.wind) else 0.0,
           "temp": g.temp if pd.notna(g.temp) else 65.0, "home_qb_name": g.home_qb_name, "away_qb_name": g.away_qb_name}
    for side, team, qb in (("home", g.home_team, g.home_qb_id), ("away", g.away_team, g.away_qb_id)):
        for key, value in team_features(team, g.kickoff, g.season).items():
            row[f"{side}_{key}"] = value
        for key, value in qb_features(qb, team, g.kickoff, g.season).items():
            row[f"{side}_{key}"] = value
    rows.append(row)

df = pd.DataFrame(rows)
df["margin"] = df.home_score - df.away_score
df["total"] = df.home_score + df.away_score
# Matchup differences (home minus away). Defensive numbers are EPA/success
# ALLOWED, so a team's expected offense = its offense + the opponent's allowed.
df["epa_edge"] = (df.home_off_epa + df.away_def_epa) - (df.away_off_epa + df.home_def_epa)
df["pass_edge"] = (df.home_off_pass_epa + df.away_def_pass_epa) - (df.away_off_pass_epa + df.home_def_pass_epa)
df["rush_edge"] = (df.home_off_rush_epa + df.away_def_rush_epa) - (df.away_off_rush_epa + df.home_def_rush_epa)
df["success_edge"] = (df.home_off_success + df.away_def_success) - (df.away_off_success + df.home_def_success)
df["qb_edge"] = df.home_qb_value - df.away_qb_value
df["qb_cpoe_edge"] = df.home_qb_cpoe.fillna(0) - df.away_qb_cpoe.fillna(0)
df["qb_new_edge"] = df.home_qb_new - df.away_qb_new
df["pace_sum"] = df.home_off_epa + df.away_off_epa + df.home_def_epa + df.away_def_epa
df.to_parquet(OUT)
print(df.shape, df.groupby("season").played.sum().to_dict())
