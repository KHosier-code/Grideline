"""Team stat profiles for college basketball: the Four Factors and shot profile.

For every team, offense and defense:
  efg     effective FG%: (FGM + 0.5 * 3PM) / FGA, threes count 1.5x
  tov     turnover rate: turnovers per possession
  orb     offensive rebound rate: OREB / (OREB + opponent DREB)
            (on defense: the opponent's offensive rebound rate)
  ftr     free throw rate: FTA / FGA
  three_rate  share of shots that are threes: 3PA / FGA
  three_pct, two_pct   shooting on threes and twos
  ft_pct  free throw shooting (offense only; defenses barely control it)

Each is adjusted for opponents the same way the ratings are: a team's
offensive number is what it did against the defenses it faced, corrected
for how those defenses usually do. `raw` keeps the unadjusted season rate.

Input is one row per team per game (see team_games), built from ESPN box
scores during the season or the sportsdataverse team box for past seasons.
"""
import numpy as np
import pandas as pd

STATS = ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "tov", "pts"]
FACTORS = ["efg", "tov", "orb", "ftr", "three_rate", "three_pct", "two_pct", "ft_pct"]
# Higher is better for the offense on these; for the others (tov) lower is better.
OFFENSE_HIGHER_IS_BETTER = {"efg": True, "tov": False, "orb": True, "ftr": True, "three_rate": None,
                            "three_pct": True, "two_pct": True, "ft_pct": True}
DEFENSE_FACTORS = ["efg", "tov", "orb", "ftr", "three_rate", "three_pct", "two_pct"]


def possessions(s):
    return s["fga"] - s["oreb"] + s["tov"] + 0.475 * s["fta"]


def team_games(games: list[dict], teams: set[str] | None = None) -> pd.DataFrame:
    """games: [{"game_id", "date", "home", "away", "stats": {team_id: {STATS...}}}] ->
    one row per team-game with the team's and the opponent's box. With `teams`
    (Division I), games against anyone else are left out."""
    rows = []
    for g in games:
        sides = g["stats"]
        if len(sides) != 2 or (teams is not None and not (g["home"] in teams and g["away"] in teams)):
            continue
        for team, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            if team not in sides or opp not in sides:
                continue
            row = {"game_id": g["game_id"], "date": g["date"], "team": team, "opp": opp}
            row.update({k: float(sides[team][k]) for k in STATS})
            row.update({f"o_{k}": float(sides[opp][k]) for k in STATS})
            rows.append(row)
    return pd.DataFrame(rows)


def game_rates(df: pd.DataFrame) -> pd.DataFrame:
    """Per team-game rates for the team's offense (its defense is the opponent's row)."""
    poss = (possessions(df) + possessions({k: df[f"o_{k}"] for k in STATS})) / 2
    two_a = df.fga - df.tpa
    out = pd.DataFrame({
        "team": df.team, "opp": df.opp, "date": df.date,
        "efg": (df.fgm + 0.5 * df.tpm) / df.fga,
        "tov": df.tov / poss,
        "orb": df.oreb / (df.oreb + df.o_dreb),
        "ftr": df.fta / df.fga,
        "three_rate": df.tpa / df.fga,
        "three_pct": df.tpm / df.tpa.where(df.tpa > 0),
        "two_pct": (df.fgm - df.tpm) / two_a.where(two_a > 0),
        "ft_pct": df.ftm / df.fta.where(df.fta > 0),
    })
    return out.replace([np.inf, -np.inf], np.nan)


def _adjust(rates: pd.DataFrame, stat: str, iterations: int = 12):
    """Additive opponent adjustment: value(team vs opp) ~ off[team] + def[opp] - league."""
    data = rates[["team", "opp", stat]].dropna()
    league = data[stat].mean()
    off = data.groupby("team")[stat].mean()
    dfn = data.groupby("opp")[stat].mean()
    for _ in range(iterations):
        off = (data[stat] - data.opp.map(dfn).fillna(league) + league).groupby(data.team).mean()
        dfn = (data[stat] - data.team.map(off).fillna(league) + league).groupby(data.opp).mean()
    return off, dfn, league


def team_factors(df: pd.DataFrame) -> dict[str, dict]:
    """{team: {"games": n, "offense": {factor: {"adj", "raw"}}, "defense": {...}}}."""
    if df.empty:
        return {}
    rates = game_rates(df)
    out: dict[str, dict] = {}
    for team, n in rates.team.value_counts().items():
        out[team] = {"games": int(n), "offense": {}, "defense": {}}
    for stat in FACTORS:
        off, dfn, _ = _adjust(rates, stat)
        raw_off = rates.groupby("team")[stat].mean()
        raw_def = rates.groupby("opp")[stat].mean()
        for team in out:
            if team in off:
                out[team]["offense"][stat] = {"adj": float(off[team]), "raw": float(raw_off[team])}
            if stat in DEFENSE_FACTORS and team in dfn:
                out[team]["defense"][stat] = {"adj": float(dfn[team]), "raw": float(raw_def[team])}
    return out


def rank_factors(factors: dict[str, dict]) -> None:
    """Adds a 1..N rank to every factor, 1 = best for that side (in place).
    Three-point rate is a style, not a strength: ranked 1 = shoots the most."""
    for side in ("offense", "defense"):
        for stat in FACTORS:
            vals = {t: f[side][stat]["adj"] for t, f in factors.items() if stat in f[side]}
            if not vals:
                continue
            better = OFFENSE_HIGHER_IS_BETTER[stat]
            if better is None:
                descending = True
            else:
                descending = better if side == "offense" else not better
            order = sorted(vals, key=lambda t: -vals[t] if descending else vals[t])
            for i, team in enumerate(order):
                factors[team][side][stat]["rank"] = i + 1


def box_from_sportsdataverse(data_dir: str, season: int) -> list[dict]:
    """Past season's games in team_games input form, from the sportsdataverse team box."""
    box = pd.read_parquet(f"{data_dir}/team_box_{season}.parquet")
    num = lambda c: pd.to_numeric(box[c], errors="coerce")  # noqa: E731
    tov = num("total_turnovers").fillna(num("turnovers"))
    frame = pd.DataFrame({
        "game_id": box.game_id.astype(str), "date": box.game_date.astype(str), "team": box.team_id.astype(str),
        "home_away": box.team_home_away,
        "fgm": num("field_goals_made"), "fga": num("field_goals_attempted"),
        "tpm": num("three_point_field_goals_made"), "tpa": num("three_point_field_goals_attempted"),
        "ftm": num("free_throws_made"), "fta": num("free_throws_attempted"),
        "oreb": num("offensive_rebounds"), "dreb": num("defensive_rebounds"), "tov": tov, "pts": num("team_score"),
    }).dropna()
    # Division I: teams with 8+ games in the file (the same rule as ratings.load_games).
    counts = frame.team.value_counts()
    frame = frame[frame.team.isin(counts[counts >= 8].index)]
    games = []
    for game_id, g in frame.groupby("game_id"):
        if len(g) != 2 or set(g.home_away) != {"home", "away"}:
            continue
        home = g[g.home_away == "home"].iloc[0]
        away = g[g.home_away == "away"].iloc[0]
        games.append({"game_id": game_id, "date": home.date, "home": home.team, "away": away.team,
                      "stats": {r.team: {k: r[k] for k in STATS} for _, r in g.iterrows()}})
    return games
