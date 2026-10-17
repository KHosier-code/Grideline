"""College basketball team ratings: opponent-adjusted efficiency and tempo.

Each team gets an offense rating (points it scores per 100 possessions above
average), a defense rating (points it allows per 100 above average; lower is
better) and a tempo rating (possessions per 40 minutes above average). They
come from a weighted ridge regression over the team's games: recent games
count more, home court is its own term, and before a team has played much
the ratings lean on last season's (shrunk toward average).

A game's projection: each side's points per 100 from its offense against the
other's defense, times the expected possessions.

Data: free sportsdataverse ESPN box scores and schedules (see fetch_data.sh).
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Params:
    half_life_days: float = 45.0  # recency: a game this many days old counts half
    ridge: float = 6.0            # pull toward the prior (in games' worth of weight)
    carryover: float = 0.6        # share of last season's rating kept as this season's prior
    min_games: int = 8            # a team needs this many games in a season to count as D-I


def load_games(data_dir: str, season: int) -> pd.DataFrame:
    """One row per D-I vs D-I game with both teams' points and possessions."""
    box = pd.read_parquet(f"{data_dir}/team_box_{season}.parquet")
    sched = pd.read_parquet(f"{data_dir}/mbb_schedule_{season}.parquet")[["game_id", "neutral_site", "date"]]
    for col in ["field_goals_attempted", "offensive_rebounds", "free_throws_attempted", "team_score"]:
        box[col] = pd.to_numeric(box[col], errors="coerce")
    turnovers = pd.to_numeric(box["total_turnovers"], errors="coerce").fillna(pd.to_numeric(box["turnovers"], errors="coerce"))
    box["poss"] = box.field_goals_attempted - box.offensive_rebounds + turnovers + 0.475 * box.free_throws_attempted
    box = box.dropna(subset=["poss", "team_score"])
    counts = box.team_id.value_counts()
    d1 = set(counts[counts >= Params.min_games].index)
    home = box[box.team_home_away == "home"]
    away = box[box.team_home_away == "away"]
    games = home.merge(away, on="game_id", suffixes=("_h", "_a"))
    games = games[games.team_id_h.isin(d1) & games.team_id_a.isin(d1)]
    games = games.merge(sched, on="game_id", how="left")
    out = pd.DataFrame({
        "game_id": games.game_id, "season": season,
        "date": pd.to_datetime(games["date"].fillna(games.game_date_h), utc=True).dt.tz_convert(None),
        "home": games.team_id_h.astype(str), "away": games.team_id_a.astype(str),
        "home_name": games.team_location_h, "away_name": games.team_location_a,
        "neutral": games.neutral_site.fillna(False).astype(bool),
        "home_pts": games.team_score_h, "away_pts": games.team_score_a,
        # One possession count per game: the average of the two sides' estimates.
        "poss": (games.poss_h + games.poss_a) / 2,
    })
    return out[(out.poss > 40) & (out.poss < 110)].sort_values("date").reset_index(drop=True)


def _solve(k, cols, vals, y, w, penalty, prior):
    """Weighted ridge toward `prior` for rows given as (column, value) pairs."""
    A = np.zeros((k, k))
    m = cols.shape[1]
    for i in range(m):
        for j in range(m):
            np.add.at(A, (cols[:, i], cols[:, j]), w * vals[:, i] * vals[:, j])
    b = np.zeros(k)
    for i in range(m):
        np.add.at(b, cols[:, i], w * vals[:, i] * y)
    A[np.diag_indices(k)] += penalty
    return np.linalg.solve(A, b + penalty * prior)


class Ratings:
    """Offense, defense and tempo for every team, fit from games before a date."""

    def __init__(self, teams: list[str], prior: dict[str, tuple[float, float, float]] | None, params: Params):
        self.teams = teams
        self.index = {team: i for i, team in enumerate(teams)}
        self.params = params
        n = len(teams)
        self.prior = np.zeros(3 * n)
        for team, (off, dfn, tempo) in (prior or {}).items():
            if team in self.index:
                i = self.index[team]
                self.prior[[i, n + i, 2 * n + i]] = np.array([off, dfn, tempo]) * params.carryover
        self.mu = 103.0
        self.hca = 3.0
        self.pace = 68.0
        self.coef = self.prior.copy()

    def fit(self, games: pd.DataFrame, as_of: pd.Timestamp):
        n = len(self.teams)
        if games.empty:
            self.coef = self.prior.copy()
            return self
        age = (as_of - games.date).dt.total_seconds().to_numpy() / 86400
        w = 0.5 ** (age / self.params.half_life_days)
        h = games.home.map(self.index).to_numpy()
        a = games.away.map(self.index).to_numpy()
        site = np.where(games.neutral.to_numpy(), 0.0, 1.0)
        ppp_h = games.home_pts.to_numpy() / games.poss.to_numpy() * 100
        ppp_a = games.away_pts.to_numpy() / games.poss.to_numpy() * 100
        pace = games.poss.to_numpy()

        # Efficiency: two rows per game (each side's points per 100 possessions).
        # Unknowns: offense[n], defense[n], mean, home edge. Each row touches
        # four columns, so the normal equations are summed directly.
        k = 2 * n + 2
        ones = np.ones_like(site)
        cols = np.concatenate([
            np.stack([h, n + a, np.full_like(h, 2 * n), np.full_like(h, 2 * n + 1)], axis=1),
            np.stack([a, n + h, np.full_like(h, 2 * n), np.full_like(h, 2 * n + 1)], axis=1),
        ])
        vals = np.concatenate([np.stack([ones, ones, ones, site], axis=1), np.stack([ones, ones, ones, -site], axis=1)])
        y = np.concatenate([ppp_h, ppp_a])
        ww = np.concatenate([w, w])
        prior = np.concatenate([self.prior[: 2 * n], [0, 0]])
        penalty = np.full(k, self.params.ridge)
        penalty[2 * n:] = 1e-6  # mean and home edge are free
        sol = _solve(k, cols, vals, y, ww, penalty, prior)
        self.mu, self.hca = sol[2 * n], sol[2 * n + 1]

        # Tempo: one row per game. Unknowns: tempo[n], mean.
        tcols = np.stack([h, a, np.full_like(h, n)], axis=1)
        tvals = np.ones((len(h), 3))
        pen_t = np.full(n + 1, self.params.ridge)
        pen_t[n] = 1e-6
        prior_t = np.concatenate([self.prior[2 * n:], [0]])
        tsol = _solve(n + 1, tcols, tvals, pace, w, pen_t, prior_t)
        self.pace = tsol[n]
        self.coef = np.concatenate([sol[: 2 * n], tsol[:n]])
        return self

    def team(self, team: str):
        n = len(self.teams)
        i = self.index[team]
        return self.coef[i], self.coef[n + i], self.coef[2 * n + i]

    def predict(self, home: str, away: str, neutral: bool):
        """(home points, away points, possessions)."""
        oh, dh, th = self.team(home)
        oa, da, ta = self.team(away)
        site = 0.0 if neutral else 1.0
        pace = self.pace + th + ta
        home_ppp = self.mu + oh + da + self.hca * site
        away_ppp = self.mu + oa + dh - self.hca * site
        return home_ppp * pace / 100, away_ppp * pace / 100, pace

    def snapshot(self) -> dict[str, tuple[float, float, float]]:
        # Defense is stored as points allowed above average (positive = worse defense).
        return {team: self.team(team) for team in self.teams}
