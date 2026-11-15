"""Bowl pool back-test: does a sheet built to *win the pool* beat the
pick-every-favorite sheet?

Input: past ESPN Bowl Mania seasons as JSON (see fetch notes in README.md),
each game with both teams' moneylines, the share of Bowl Mania players who
picked each team, and the winner. ESPN's data is not committed; pass the path.

Opponents pick each game the way Bowl Mania players did (a team picked by 70%
of players is picked by each simulated opponent 70% of the time). In
confidence pools they put their most points on picks the crowd agrees with
most, with some randomness. Outcomes are drawn from the de-vigged moneylines.

Our sheet starts as chalk (every Vegas favorite, points in order of win
chance) and is improved by flipping picks and swapping points, judged on one
set of simulations and scored on a fresh set, so it can't just memorise noise.

usage: python bowl_backtest.py bowlmania.json [--sims 4000] [--eval 20000]
"""
import argparse
import json

import numpy as np


def decimal(american: float) -> float:
    return 1 + american / 100 if american > 0 else 1 + 100 / abs(american)


def load_seasons(path):
    seasons = {}
    for game in json.load(open(path)):
        teams = game["o"]
        if len(teams) != 2 or not game.get("c") or not all(team.get("line") for team in teams):
            continue
        implied = [1 / decimal(float(team["line"])) for team in teams]
        win_a = implied[0] / sum(implied)
        crowd_a = teams[0]["p"].get("1")
        if crowd_a is None:
            continue
        winner = 0 if game["c"][0] == teams[0]["id"] else 1 if game["c"][0] == teams[1]["id"] else None
        if winner is None:
            continue
        seasons.setdefault(game["s"], []).append({
            "name": game["n"], "win_a": win_a, "crowd_a": crowd_a, "a_won": winner == 0,
            "teams": (teams[0]["a"], teams[1]["a"]),
        })
    return {season: {
        "games": games,
        "p": np.array([g["win_a"] for g in games]),
        "q": np.clip(np.array([g["crowd_a"] for g in games]), 0.01, 0.99),
        "actual": np.array([g["a_won"] for g in games]),
    } for season, games in sorted(seasons.items())}


SHARP = 0.0


def opponents(q, pool, sims, confidence, rng, noise=1.0, p=None):
    """Each opponent's picks (True = team A) and points per game: (sims, pool, games).

    A share SHARP of opponents follow the betting favorites (90% of the time)
    and rank their points by the line instead of by the crowd.
    """
    n = len(q)
    sharp = np.zeros(pool, dtype=bool)
    if p is not None and SHARP > 0:
        sharp[: int(round(SHARP * pool))] = True
    lean = np.where(sharp[:, None], np.where(p >= 0.5, 0.9, 0.1)[None, :] if p is not None else q, q[None, :])
    picks = rng.random((sims, pool, n)) < lean[None, :, :]
    if not confidence:
        return picks, np.ones((sims, pool, n))
    basis = np.where(sharp[:, None], (p if p is not None else q)[None, :], q[None, :])
    share = np.clip(np.where(picks, basis[None], 1 - basis[None]), 0.01, 0.99)
    conviction = np.log(share / (1 - share)) + rng.normal(0, noise, (sims, pool, n))
    points = conviction.argsort(axis=2).argsort(axis=2) + 1.0
    return picks, points


def best_rival(outcomes, picks, points):
    """Highest opponent score in each simulated pool."""
    right = picks == outcomes[:, None, :]
    return (right * points).sum(axis=2).max(axis=1)


def win_rate(sheet_picks, sheet_points, outcomes, rival):
    """Chance our sheet finishes first (ties split evenly; the rival count is approximate for ties)."""
    ours = ((sheet_picks == outcomes) * sheet_points).sum(axis=1)
    return float(np.mean(np.where(ours > rival, 1.0, np.where(ours == rival, 0.5, 0.0))))


def chalk(p, confidence):
    picks = p >= 0.5
    if not confidence:
        return picks, np.ones(len(p))
    sure = np.maximum(p, 1 - p)
    return picks, sure.argsort().argsort() + 1.0


def optimise(p, q, pool, confidence, sims, rng, rounds=6):
    outcomes = rng.random((sims, len(p))) < p
    rival = best_rival(outcomes, *opponents(q, pool, sims, confidence, rng, p=p))
    picks, points = chalk(p, confidence)
    best = win_rate(picks, points, outcomes, rival)
    for _ in range(rounds):
        improved = False
        for i in range(len(p)):
            trial = picks.copy(); trial[i] = ~trial[i]
            score = win_rate(trial, points, outcomes, rival)
            if score > best + 1e-9:
                picks, best, improved = trial, score, True
        if confidence:
            for i in range(len(p)):
                for j in range(i + 1, len(p)):
                    trial = points.copy(); trial[i], trial[j] = trial[j], trial[i]
                    score = win_rate(picks, trial, outcomes, rival)
                    if score > best + 1e-9:
                        points, best, improved = trial, score, True
        if not improved:
            break
    return picks, points


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data")
    parser.add_argument("--sims", type=int, default=4000)
    parser.add_argument("--eval", type=int, default=20000)
    parser.add_argument("--pools", default="10,25,50,100")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--out")
    parser.add_argument("--sharp", type=float, default=0.0, help="share of opponents who follow the betting favorites")
    args = parser.parse_args()
    global SHARP
    SHARP = args.sharp
    seasons = load_seasons(args.data)
    rng = np.random.default_rng(args.seed)
    rows = []
    for confidence in (True, False):
        for pool in [int(x) for x in args.pools.split(",")]:
            for season, s in seasons.items():
                p, q, actual = s["p"], s["q"], s["actual"]
                picks, points = optimise(p, q, pool, confidence, args.sims, rng)
                c_picks, c_points = chalk(p, confidence)
                # Fresh simulations to score both sheets: outcomes from the lines...
                outcomes = rng.random((args.eval, len(p))) < p
                rival = best_rival(outcomes, *opponents(q, pool, args.eval, confidence, rng, p=p))
                # ...and the real results, with many draws of who else was in the pool.
                real = np.repeat(actual[None, :], args.eval, axis=0)
                real_rival = best_rival(real, *opponents(q, pool, args.eval, confidence, rng, p=p))
                rows.append({
                    "scoring": "confidence" if confidence else "straight", "pool": pool, "season": season,
                    "games": len(p), "fair_share": 1 / (pool + 1),
                    "chalk_sim": win_rate(c_picks, c_points, outcomes, rival),
                    "ours_sim": win_rate(picks, points, outcomes, rival),
                    "chalk_real": win_rate(c_picks, c_points, real, real_rival),
                    "ours_real": win_rate(picks, points, real, real_rival),
                    "flips": int((picks != c_picks).sum()),
                })
                r = rows[-1]
                print(f"{r['scoring']:10} pool {pool:3d} {season}: fair {r['fair_share']:.3f} | "
                      f"if lines are right: chalk {r['chalk_sim']:.3f} ours {r['ours_sim']:.3f} | "
                      f"actual results: chalk {r['chalk_real']:.3f} ours {r['ours_real']:.3f} | flips {r['flips']}",
                      flush=True)
    if args.out:
        json.dump(rows, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
