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
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bowl_engine as engine  # noqa: E402



def load_seasons(path):
    seasons = {}
    for game in json.load(open(path)):
        teams = game["o"]
        if len(teams) != 2 or not game.get("c") or not all(team.get("line") for team in teams):
            continue
        win_a = engine.win_chance(float(teams[0]["line"]), float(teams[1]["line"]))
        # Bowl Mania scoring formats: 1 straight-up picks (the default), 2
        # confidence points, 3 against the spread. Each pool type is played
        # against the crowd from its own format.
        crowd_straight, crowd_confidence = teams[0]["p"].get("1"), teams[0]["p"].get("2")
        if crowd_straight is None or crowd_confidence is None:
            continue
        winner = 0 if game["c"][0] == teams[0]["id"] else 1 if game["c"][0] == teams[1]["id"] else None
        if winner is None:
            continue
        seasons.setdefault(game["s"], []).append({
            "name": game["n"], "win_a": win_a, "crowd_straight": crowd_straight,
            "crowd_confidence": crowd_confidence, "a_won": winner == 0,
            "teams": (teams[0]["a"], teams[1]["a"]),
        })
    return {season: {
        "games": games,
        "p": np.array([g["win_a"] for g in games]),
        "q_straight": np.clip(np.array([g["crowd_straight"] for g in games]), 0.01, 0.99),
        "q_confidence": np.clip(np.array([g["crowd_confidence"] for g in games]), 0.01, 0.99),
        "actual": np.array([g["a_won"] for g in games]),
    } for season, games in sorted(seasons.items())}


def tune_with(p, q, pool, confidence, rng, sims, settings, rounds=6):
    """bowl_engine.tune, but with explicit opponent settings instead of a named pool type."""
    outcomes, rival = engine.simulate_rivals(p, q, pool, sims, confidence, rng, **settings)
    picks, points = engine.chalk(p, confidence)
    best = engine.win_rate(picks, points, outcomes, rival)
    for _ in range(rounds):
        improved = False
        for i in range(len(p)):
            trial = picks.copy(); trial[i] = ~trial[i]
            score = engine.win_rate(trial, points, outcomes, rival)
            if score > best + 1e-9:
                picks, best, improved = trial, score, True
        if confidence:
            for i in range(len(p)):
                for j in range(i + 1, len(p)):
                    trial = points.copy(); trial[i], trial[j] = trial[j], trial[i]
                    score = engine.win_rate(picks, trial, outcomes, rival)
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
    parser.add_argument("--style", type=float, default=0.0, help="spread of opponents' lean toward favorites or upsets")
    parser.add_argument("--noise", type=float, default=1.0, help="how randomly opponents order confidence points")
    parser.add_argument("--scoring", default="confidence,straight")
    args = parser.parse_args()
    settings = {"style": args.style, "noise": args.noise, "sharp": args.sharp}
    seasons = load_seasons(args.data)
    rng = np.random.default_rng(args.seed)
    rows = []
    for confidence in [kind == "confidence" for kind in args.scoring.split(",")]:
        for pool in [int(x) for x in args.pools.split(",")]:
            for season, s in seasons.items():
                p, actual = s["p"], s["actual"]
                q = s["q_confidence"] if confidence else s["q_straight"]
                picks, points = tune_with(p, q, pool, confidence, rng, args.sims, settings)
                c_picks, c_points = engine.chalk(p, confidence)
                # Fresh simulations to score both sheets: outcomes from the lines...
                outcomes, rival = engine.simulate_rivals(p, q, pool, args.eval, confidence, rng, **settings)
                # ...and the real results, with many draws of who else was in the pool.
                real = np.repeat(actual[None, :], args.eval, axis=0)
                _, real_rival = engine.simulate_rivals(p, q, pool, args.eval, confidence, rng, outcomes=real, **settings)
                rows.append({
                    "scoring": "confidence" if confidence else "straight", "pool": pool, "season": season,
                    "games": len(p), "fair_share": 1 / (pool + 1),
                    "chalk_sim": engine.win_rate(c_picks, c_points, outcomes, rival),
                    "ours_sim": engine.win_rate(picks, points, outcomes, rival),
                    "chalk_real": engine.win_rate(c_picks, c_points, real, real_rival),
                    "ours_real": engine.win_rate(picks, points, real, real_rival),
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
