"""Does a roster-turnover preseason prior beat "last season, shrunk 10%"?

Usage: python backtest_roster.py DATA_DIR

Same walk-forward test as backtest.py. The only change is the preseason
prior: for each season it comes from a regression (fit only on earlier
seasons) of a team's final ratings on last season's ratings, how much of
last season's production returned, and what transfers brought in. The prior
strength (ridge) is retuned on 2021-2023; 2024-2026 stay untouched.
"""
import sys
from dataclasses import replace

import pandas as pd

import backtest
from backtest import summarize
from ratings import Params, Ratings, load_games
from roster import RosterPrior, design, player_seasons, turnover

DATA = sys.argv[1]
backtest.DATA = DATA
BASE = Params()
FIRST_DATA, LAST = 2019, 2026


def final_ratings(season, prior, params):
    games = load_games(DATA, season)
    teams = sorted(set(games.home) | set(games.away))
    model = Ratings(teams, prior, params).fit(games, games.date.max() + pd.Timedelta(days=1))
    return model.snapshot()


# Final ratings by season (baseline chain), turnover tables, and design rows.
finals, players = {}, {}
prior = None
for season in range(FIRST_DATA, LAST + 1):
    finals[season] = prior = final_ratings(season, prior, BASE)
    players[season] = player_seasons(DATA, season)

rows = {}
for season in range(FIRST_DATA + 1, LAST + 1):
    prev = finals[season - 1]
    net = {team: off - dfn for team, (off, dfn, _) in prev.items()}
    X = design(prev, turnover(players[season - 1], players[season], net))
    rows[season] = X


def roster_prior(season):
    """Prior for `season` from a regression trained on seasons before it."""
    train = [s for s in rows if s < season]
    X = pd.concat([rows[s] for s in train])
    target = pd.concat([pd.DataFrame(finals[s], index=["off", "def", "tempo"]).T.reindex(rows[s].index) for s in train])
    keep = target.notna().all(axis=1).to_numpy()
    model = RosterPrior().fit(X[keep], target.off[keep], target["def"][keep])
    off, dfn = model.predict(rows[season])
    prev = finals[season - 1]
    return {team: (o, d, prev.get(team, (0, 0, 0))[2] * BASE.carryover)
            for team, o, d in zip(rows[season].index, off, dfn)}, model


def run(seasons, params, use_roster):
    out = []
    for season in seasons:
        if use_roster:
            prior, _ = roster_prior(season)
            p = replace(params, carryover=1.0)  # the regression already shrinks
        else:
            prior, p = finals[season - 1], params
        games = load_games(DATA, season)
        teams = sorted(set(games.home) | set(games.away))
        model = Ratings(teams, prior, p)
        preds = []
        for day, today in games.groupby(games.date.dt.normalize()):
            model.fit(games[games.date < day], day)
            for g in today.itertuples():
                hp, ap, _ = model.predict(g.home, g.away, g.neutral)
                preds.append((g.game_id, hp - ap, hp + ap))
        out.append(games.merge(pd.DataFrame(preds, columns=["game_id", "pred_margin", "pred_total"]), on="game_id"))
    return pd.concat(out)


def report(frame, label):
    months = frame.assign(month=frame.date.dt.month)
    parts = [("all", months), ("November", months[months.month == 11]), ("December", months[months.month == 12]),
             ("Jan-Apr", months[months.month.isin([1, 2, 3, 4])])]
    return [{**summarize(part, name), "model": label} for name, part in parts]


if __name__ == "__main__":
    tune = [2021, 2022, 2023]
    best = None
    for ridge in (2, 3, 5, 8, 12):
        score = summarize(run(tune, replace(BASE, ridge=ridge), True), "")["margin_mae"]
        print(f"roster prior, ridge {ridge:>2}: margin MAE {score:.3f} (2021-23)", flush=True)
        if best is None or score < best[0]:
            best = (score, ridge)
    print(f"\nChosen ridge {best[1]}. Untouched 2024-2026:\n")
    test = [2024, 2025, 2026]
    table = report(run(test, BASE, False), "last season x0.9") + report(run(test, replace(BASE, ridge=best[1]), True), "roster prior")
    print(pd.DataFrame(table).sort_values(["label", "model"]).round(3).to_string(index=False))
    _, model = roster_prior(2026)
    print("\nPrior regression (trained 2020-2025), offense:", dict(zip(["const"] + list(rows[2026].columns), model.b_off.round(3))))
    print("defense:", dict(zip(["const"] + list(rows[2026].columns), model.b_def.round(3))))
