"""Preseason priors from roster turnover.

Last season's rating says less about a team that lost most of its players.
For each team-season this measures, from player box scores:

  ret_prod  share of last season's production (game score) by players on
            this season's roster
  in_prod   production transfers bring in from other D-I teams, as a share
            of the team's own production last season
  in_net    the average net rating of the teams those transfers came from

A regression fit on earlier seasons then maps last season's offense and
defense plus these numbers to a preseason offense and defense.

Rosters: in the backtest a team's roster is everyone who plays for it that
season. Live, it comes from ESPN's preseason roster pages, which is the same
information known before tip-off.
"""
import numpy as np
import pandas as pd


def player_seasons(data_dir: str, season: int) -> pd.DataFrame:
    """Minutes and game score per player per team in a season."""
    p = pd.read_parquet(f"{data_dir}/player_box_{season}.parquet")
    p = p[(p.did_not_play != True) & p.minutes.notna() & p.athlete_id.notna()]  # noqa: E712
    f = {c: pd.to_numeric(p[c], errors="coerce").fillna(0) for c in [
        "points", "field_goals_made", "field_goals_attempted", "free_throws_made", "free_throws_attempted",
        "offensive_rebounds", "defensive_rebounds", "steals", "assists", "blocks", "fouls", "turnovers", "minutes"]}
    game_score = (f["points"] + 0.4 * f["field_goals_made"] - 0.7 * f["field_goals_attempted"]
                  - 0.4 * (f["free_throws_attempted"] - f["free_throws_made"]) + 0.7 * f["offensive_rebounds"]
                  + 0.3 * f["defensive_rebounds"] + f["steals"] + 0.7 * f["assists"] + 0.7 * f["blocks"]
                  - 0.4 * f["fouls"] - f["turnovers"])
    out = pd.DataFrame({"athlete": p.athlete_id.astype("int64").astype(str), "team": p.team_id.astype(str),
                        "minutes": f["minutes"], "prod": game_score})
    out = out.groupby(["athlete", "team"], as_index=False).sum()
    totals = out.groupby("team")[["minutes", "prod"]].transform("sum")
    out["min_share"] = out.minutes / totals.minutes
    out["prod_share"] = out["prod"] / totals["prod"]
    return out


def turnover(last: pd.DataFrame, this: pd.DataFrame, last_net: dict[str, float]) -> pd.DataFrame:
    """Turnover numbers for every team on this season's rosters."""
    roster = this[["athlete", "team"]].drop_duplicates()
    # Returning: on the same team both seasons.
    ret = last.merge(roster, on=["athlete", "team"])
    ret = ret.groupby("team").agg(ret_min=("min_share", "sum"), ret_prod=("prod_share", "sum"))
    # Transfers: on this team now, on a different team last season (biggest last-season role if several).
    moved = last.merge(roster, on="athlete", suffixes=("_old", ""))
    moved = moved[moved.team_old != moved.team].sort_values("minutes", ascending=False).drop_duplicates("athlete")
    own = last.groupby("team")["prod"].sum()
    moved["old_net"] = moved.team_old.map(last_net)
    moved = moved.dropna(subset=["old_net"])
    incoming = moved.groupby("team").apply(lambda g: pd.Series({
        "in_prod_raw": g["prod"].sum(),
        "in_net": np.average(g.old_net, weights=g["prod"].clip(lower=0.1)),
    }), include_groups=False)
    out = pd.DataFrame(index=sorted(set(roster.team)))
    out = out.join(ret).join(incoming)
    out["in_prod"] = (out.in_prod_raw / out.index.map(own)).fillna(0).clip(upper=1.5)
    out = out.fillna({"ret_min": 0, "ret_prod": 0, "in_net": 0})
    return out[["ret_min", "ret_prod", "in_prod", "in_net"]]


FEATURES = ["off", "def", "off_ret", "def_ret", "in_prod", "in_prod_net", "ret_prod"]


def design(prev: dict[str, tuple[float, float, float]], turn: pd.DataFrame) -> pd.DataFrame:
    """One row per team: last season's ratings (0 for new D-I teams) and turnover."""
    rows = []
    for team, t in turn.iterrows():
        off, dfn, _ = prev.get(team, (0.0, 0.0, 0.0))
        rows.append({"team": team, "off": off, "def": dfn,
                     "off_ret": off * t.ret_prod, "def_ret": dfn * t.ret_prod,
                     "in_prod": t.in_prod, "in_prod_net": t.in_prod * t.in_net, "ret_prod": t.ret_prod})
    return pd.DataFrame(rows).set_index("team")


class RosterPrior:
    """Linear map from (last season, turnover) to this season's offense and defense."""

    def fit(self, X: pd.DataFrame, y_off: pd.Series, y_def: pd.Series):
        A = np.column_stack([np.ones(len(X)), X[FEATURES].to_numpy()])
        self.b_off = np.linalg.lstsq(A, y_off.to_numpy(), rcond=None)[0]
        self.b_def = np.linalg.lstsq(A, y_def.to_numpy(), rcond=None)[0]
        return self

    def predict(self, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        A = np.column_stack([np.ones(len(X)), X[FEATURES].to_numpy()])
        return A @ self.b_off, A @ self.b_def
