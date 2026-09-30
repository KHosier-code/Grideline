"""Build one row per (player, game) with features known before kickoff.

Label: player scored >= 1 rushing or receiving TD (passing TDs never count).
All rolling features use only games strictly before the target game, and
windows carry across seasons (a player's last 8 games may include last year).
"""
import sys
from datetime import date
import numpy as np
import pandas as pd

DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
# NFL seasons run September-February; January and February belong to last year's season.
CURRENT_SEASON = date.today().year if date.today().month >= 3 else date.today().year - 1
SEASONS = list(range(2019, CURRENT_SEASON + 1))
POSITIONS = ["QB", "RB", "WR", "TE"]


def load_games():
    g = pd.read_csv(f"{DATA}/games.csv")
    g = g[(g.game_type == "REG") & g.season.isin(SEASONS)].copy()
    # nflverse spread_line is how many points the home team is favored by.
    g["home_implied"] = (g.total_line + g.spread_line) / 2
    g["away_implied"] = (g.total_line - g.spread_line) / 2
    g["kickoff_order"] = pd.to_datetime(g.gameday + " " + g.gametime.fillna("13:00"))
    home = g.assign(team=g.home_team, opponent=g.away_team, is_home=1, implied=g.home_implied,
                    opp_implied=g.away_implied, points=g.home_score, points_allowed=g.away_score)
    away = g.assign(team=g.away_team, opponent=g.home_team, is_home=0, implied=g.away_implied,
                    opp_implied=g.home_implied, points=g.away_score, points_allowed=g.home_score)
    cols = ["game_id", "season", "week", "kickoff_order", "team", "opponent", "is_home", "implied",
            "opp_implied", "total_line", "spread_line", "points", "points_allowed", "roof", "wind"]
    return pd.concat([home[cols], away[cols]], ignore_index=True)


def load_red_zone():
    frames = []
    for season in SEASONS:
        try:
            p = pd.read_parquet(f"{DATA}/pbp_{season}.parquet", columns=[
                "game_id", "season_type", "posteam", "yardline_100", "pass_attempt", "rush_attempt",
                "receiver_player_id", "rusher_player_id", "two_point_attempt", "qb_kneel", "qb_spike",
                "play_type"])
        except FileNotFoundError:
            continue
        p = p[(p.season_type == "REG") & p.yardline_100.notna() & (p.two_point_attempt != 1)
              & (p.qb_kneel != 1) & (p.qb_spike != 1) & p.play_type.isin(["pass", "run"])]
        for zone in (20, 10, 5):
            z = p[p.yardline_100 <= zone]
            tg = z[(z.pass_attempt == 1) & z.receiver_player_id.notna()].groupby(
                ["game_id", "posteam", "receiver_player_id"]).size().rename(f"rz{zone}_tgt")
            ca = z[(z.rush_attempt == 1) & z.rusher_player_id.notna()].groupby(
                ["game_id", "posteam", "rusher_player_id"]).size().rename(f"rz{zone}_car")
            tg.index.names = ca.index.names = ["game_id", "team", "player_id"]
            frames.append(pd.concat([tg, ca], axis=1))
    rz = pd.concat(frames).groupby(level=[0, 1, 2]).sum(min_count=1).fillna(0).reset_index()
    # Team red-zone volume (for shares) and opponent red-zone plays allowed.
    team = rz.groupby(["game_id", "team"])[[c for c in rz.columns if c.startswith("rz")]].sum().reset_index()
    team.columns = ["game_id", "team"] + [f"team_{c}" for c in team.columns[2:]]
    return rz, team


def load_player_games():
    frames = []
    for season in SEASONS:
        try:
            s = pd.read_parquet(f"{DATA}/stats_{season}.parquet")
        except FileNotFoundError:
            continue
        s = s[(s.season_type == "REG") & s.position.isin(POSITIONS)]
        frames.append(s[["player_id", "player_display_name", "position", "season", "week", "game_id", "team",
                         "opponent_team", "targets", "carries", "receptions", "receiving_yards",
                         "rushing_yards", "rushing_tds", "receiving_tds"]])
    s = pd.concat(frames, ignore_index=True).rename(columns={"player_display_name": "name", "opponent_team": "opponent"})
    for c in ["targets", "carries", "receptions", "receiving_yards", "rushing_yards", "rushing_tds", "receiving_tds"]:
        s[c] = s[c].fillna(0)
    s["tds"] = s.rushing_tds + s.receiving_tds
    s["label"] = (s.tds > 0).astype(int)
    return s


def upcoming_rows(games, players):
    """Candidate rows for the next unplayed week: anyone who played for the team in its last two games."""
    unplayed = games[games.points.isna() & (games.season == games.season.max())]
    if unplayed.empty:
        return pd.DataFrame()
    week = unplayed.week.min()
    slate = unplayed[unplayed.week == week]
    season = int(slate.season.iloc[0])
    recent = players[players.season == season]
    last_games = recent[["team", "week"]].drop_duplicates().sort_values("week").groupby("team").tail(2)
    cand = recent.merge(last_games, on=["team", "week"])
    cand = cand.sort_values("week").groupby("player_id").tail(1)[["player_id", "name", "position", "team"]]
    rows = cand.merge(slate, on="team")
    for c in ["targets", "carries", "receptions", "receiving_yards", "rushing_yards", "rushing_tds", "receiving_tds", "tds"]:
        rows[c] = 0.0
    rows["label"] = np.nan
    rows["upcoming"] = 1
    return rows


def rolling_prior(df, keys, cols, window, prefix):
    """Mean of the previous `window` rows per key, excluding the current row."""
    df = df.sort_values(keys + ["kickoff_order"])
    g = df.groupby(keys, sort=False)[cols]
    out = g.transform(lambda x: x.shift(1).rolling(window, min_periods=1).mean())
    out.columns = [f"{prefix}{c}" for c in cols]
    return out.reindex(df.index)


def main():
    games = load_games()
    players = load_player_games()
    rz, team_rz = load_red_zone()

    df = players.merge(games, on=["game_id", "season", "week", "team", "opponent"], how="inner")
    df["upcoming"] = 0
    upcoming = upcoming_rows(games, players)
    if len(upcoming):
        df = pd.concat([df, upcoming], ignore_index=True)
    df = df.merge(rz, on=["game_id", "team", "player_id"], how="left")
    rz_cols = [c for c in rz.columns if c.startswith("rz")]
    df[rz_cols] = df[rz_cols].fillna(0)
    df = df.merge(team_rz, on=["game_id", "team"], how="left")

    # Team volume per game for shares.
    team_vol = players.groupby(["game_id", "team"])[["targets", "carries"]].sum().reset_index().rename(
        columns={"targets": "team_targets", "carries": "team_carries"})
    df = df.merge(team_vol, on=["game_id", "team"], how="left")
    df = df.sort_values(["player_id", "kickoff_order"]).reset_index(drop=True)

    usage = ["targets", "carries", "receptions", "receiving_yards", "rushing_yards", "tds", "label",
             "team_targets", "team_carries"] + rz_cols + [f"team_{c}" for c in rz_cols]
    for window, prefix in [(3, "l3_"), (8, "l8_"), (17, "l17_")]:
        df = pd.concat([df, rolling_prior(df, ["player_id"], usage, window, prefix)], axis=1)
    df["prior_games"] = df.groupby("player_id").cumcount()
    # Games with the current team in the last 8 (captures trades / new teams).
    df["same_team_prev"] = (df.groupby("player_id").team.shift(1) == df.team).astype(int)

    # Shares over the last 8 games.
    def share(num, den):
        return np.where(df[den] > 0, df[num] / df[den].replace(0, np.nan), np.nan)
    df["tgt_share8"] = share("l8_targets", "l8_team_targets")
    df["car_share8"] = share("l8_carries", "l8_team_carries")
    df["tgt_share3"] = share("l3_targets", "l3_team_targets")
    df["car_share3"] = share("l3_carries", "l3_team_carries")
    for zone in (20, 10, 5):
        df[f"rz{zone}_tgt_share8"] = share(f"l8_rz{zone}_tgt", f"l8_team_rz{zone}_tgt")
        df[f"rz{zone}_car_share8"] = share(f"l8_rz{zone}_car", f"l8_team_rz{zone}_car")
    df["rz_opps8"] = df.l8_rz20_tgt + df.l8_rz20_car
    df["gl_opps8"] = df.l8_rz5_tgt + df.l8_rz5_car
    df["rz_opps17"] = df.l17_rz20_tgt + df.l17_rz20_car

    # Shrunk TD rate: blend player's last-17 rate with the position average (prior of 6 games).
    pos_rate = df.groupby("position").label.mean()
    n = df.prior_games.clip(upper=17)
    df["td_rate_shrunk"] = (df.l17_label.fillna(0) * n + df.position.map(pos_rate) * 6) / (n + 6)

    # Opponent defense vs position: TD scorers allowed per game to that position, last 8 opponent games.
    allowed = df.groupby(["game_id", "opponent", "position"]).agg(
        pos_tds=("tds", "sum"), pos_scorers=("label", "sum")).reset_index()
    opp_games = games[["game_id", "team", "kickoff_order"]].rename(columns={"team": "opponent"})
    grid = opp_games.merge(pd.DataFrame({"position": POSITIONS}), how="cross")
    allowed = grid.merge(allowed, on=["game_id", "opponent", "position"], how="left").fillna({"pos_tds": 0, "pos_scorers": 0})
    allowed = allowed.sort_values(["opponent", "position", "kickoff_order"])
    grp = allowed.groupby(["opponent", "position"])
    allowed["opp_pos_tds8"] = grp.pos_tds.transform(lambda x: x.shift(1).rolling(8, min_periods=1).mean())
    allowed["opp_pos_games8"] = grp.pos_tds.transform(lambda x: x.shift(1).rolling(8, min_periods=1).count())
    league = allowed.groupby("position").pos_tds.mean()
    allowed["opp_pos_tds8_shrunk"] = (allowed.opp_pos_tds8.fillna(0) * allowed.opp_pos_games8.fillna(0)
                                      + allowed.position.map(league) * 4) / (allowed.opp_pos_games8.fillna(0) + 4)
    allowed["opp_pos_tds_ratio"] = allowed.opp_pos_tds8_shrunk / allowed.position.map(league)
    df = df.merge(allowed[["game_id", "opponent", "position", "opp_pos_tds8_shrunk", "opp_pos_tds_ratio"]],
                  on=["game_id", "opponent", "position"], how="left")

    # Opponent red-zone plays allowed and points allowed (last 8).
    trz = team_rz.merge(games[["game_id", "team", "opponent", "kickoff_order"]], on=["game_id", "team"])
    trz = trz.sort_values(["opponent", "kickoff_order"])
    trz["team_rz20"] = trz.team_rz20_tgt + trz.team_rz20_car
    trz["opp_rz_allowed8"] = trz.groupby("opponent").team_rz20.transform(lambda x: x.shift(1).rolling(8, min_periods=1).mean())
    df = df.merge(trz[["game_id", "opponent", "opp_rz_allowed8"]], on=["game_id", "opponent"], how="left")

    # Team's own recent red-zone volume (offense quality in scoring position).
    own = trz.rename(columns={"opponent": "_o"}).sort_values(["team", "kickoff_order"])
    own["team_rz_pg8"] = own.groupby("team").team_rz20.transform(lambda x: x.shift(1).rolling(8, min_periods=1).mean())
    df = df.merge(own[["game_id", "team", "team_rz_pg8"]], on=["game_id", "team"], how="left")

    df["implied_share_rz"] = df.implied * df.rz20_tgt_share8.fillna(0) + df.implied * df.rz20_car_share8.fillna(0)
    df.to_parquet(sys.argv[2] if len(sys.argv) > 2 else "td_dataset.parquet")
    print(df.shape, df.label.mean().round(4))
    print(df.groupby("season").size())


if __name__ == "__main__":
    main()
