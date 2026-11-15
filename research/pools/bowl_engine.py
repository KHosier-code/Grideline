"""Bowl pool sheets: win chances from betting lines, a simulated pool of
opponents who pick the way the public does, and a pick sheet built to finish
first in that pool. Used by the back-test (bowl_backtest.py) and the daily job
(bowls_daily.py). Method and results: README.md.
"""
from __future__ import annotations

import numpy as np

# How opponents play, by how serious the pool is (README: scenarios A, B, E).
#   style: spread of each opponent's lean toward favorites or upsets
#   noise: how randomly they order confidence points
#   sharp: share of opponents who follow the betting favorites
POOL_TYPES = {
    "casual": {"style": 0.0, "noise": 1.0, "sharp": 0.0},
    "mixed": {"style": 1.0, "noise": 1.0, "sharp": 0.0},
    "sharp": {"style": 1.0, "noise": 0.5, "sharp": 0.2},
}


def decimal_odds(american: float) -> float:
    return 1 + american / 100 if american > 0 else 1 + 100 / abs(american)


def win_chance(moneyline_a: float, moneyline_b: float) -> float:
    """Team A's chance to win from both moneylines, with the book's cut removed."""
    a, b = 1 / decimal_odds(moneyline_a), 1 / decimal_odds(moneyline_b)
    return a / (a + b)


def spread_win_chance(spread_a: float, sd: float = 15.5) -> float:
    """Team A's chance from its point spread (negative = favored), when there's no moneyline."""
    from math import erf, sqrt
    return 0.5 * (1 + erf(-spread_a / (sd * sqrt(2))))


def opponents(p, q, pool, sims, confidence, rng, style=0.0, noise=1.0, sharp=0.0):
    """Simulated opponents' picks (True = team A) and points, shaped (sims, pool, games).

    p: each game's chance team A wins (from the lines)
    q: share of the public picking team A
    """
    n = len(q)
    is_sharp = np.zeros(pool, dtype=bool)
    is_sharp[: int(round(sharp * pool))] = True
    favorite_a = p >= 0.5
    lean = np.where(is_sharp[:, None], np.where(favorite_a, 0.9, 0.1)[None, :], q[None, :])
    lean = np.broadcast_to(lean, (sims, pool, n))
    if style > 0:
        offset = rng.normal(0, style, (sims, pool, 1))
        logit = np.log(lean / (1 - lean)) + np.where(favorite_a[None, None, :], offset, -offset)
        lean = np.where(is_sharp[None, :, None], lean, 1 / (1 + np.exp(-logit)))
    picks = rng.random((sims, pool, n)) < lean
    if not confidence:
        return picks, np.ones((1, 1, n))
    basis = np.where(is_sharp[:, None], p[None, :], q[None, :])
    share = np.clip(np.where(picks, basis[None], 1 - basis[None]), 0.01, 0.99)
    conviction = np.log(share / (1 - share)) + rng.normal(0, noise, (sims, pool, n))
    return picks, conviction.argsort(axis=2).argsort(axis=2) + 1.0


def best_rival(outcomes, picks, points):
    """Top opponent score in each simulated pool, and how many opponents share it."""
    scores = ((picks == outcomes[:, None, :]) * points).sum(axis=2)
    top = scores.max(axis=1)
    return top, (scores == top[:, None]).sum(axis=1)


def simulate_rivals(p, q, pool, sims, confidence, rng, outcomes=None, chunk=1000, **pool_type):
    """Outcomes drawn from the lines (unless given) and the best rival in each pool, in chunks to bound memory."""
    if outcomes is None:
        outcomes = rng.random((sims, len(p))) < p
    tops, ties = [], []
    for start in range(0, len(outcomes), chunk):
        part = outcomes[start:start + chunk]
        top, tied = best_rival(part, *opponents(p, q, pool, len(part), confidence, rng, **pool_type))
        tops.append(top); ties.append(tied)
    return outcomes, (np.concatenate(tops), np.concatenate(ties))


def win_rate(picks, points, outcomes, rival):
    """Chance a sheet finishes first, splitting a tie evenly with every rival who shares it."""
    top, tied = rival
    ours = ((picks == outcomes) * points).sum(axis=1)
    return float(np.mean(np.where(ours > top, 1.0, np.where(ours == top, 1.0 / (tied + 1), 0.0))))


def chalk(p, confidence):
    """Every betting favorite, with the most points on the surest games."""
    picks = p >= 0.5
    if not confidence:
        return picks, np.ones(len(p))
    return picks, np.maximum(p, 1 - p).argsort(kind="stable").argsort() + 1.0


def tune(p, q, pool, confidence, rng, sims=1500, rounds=6, pool_type="mixed"):
    """Start from chalk; keep any pick flip or point swap that raises the chance of finishing first."""
    outcomes, rival = simulate_rivals(p, q, pool, sims, confidence, rng, **POOL_TYPES[pool_type])
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


def build_sheet(p, q, pool, confidence, rng, pool_type="mixed", sims=1500, check_sims=4000):
    """A tuned sheet plus fresh-simulation estimates of how often it, chalk and a random entry finish first."""
    picks, points = tune(p, q, pool, confidence, rng, sims=sims, pool_type=pool_type)
    outcomes, rival = simulate_rivals(p, q, pool, check_sims, confidence, rng, **POOL_TYPES[pool_type])
    c_picks, c_points = chalk(p, confidence)
    return {
        "picks": picks, "points": points,
        "win": win_rate(picks, points, outcomes, rival),
        "chalk_win": win_rate(c_picks, c_points, outcomes, rival),
        "fair": 1 / (pool + 1),
    }
