"""Can the public's picks be estimated from the betting line alone, as a
fallback for when ESPN's Bowl Mania pick data isn't available? No: see the
result below. Fit on 2022-2025 Bowl Mania (fetch_bowlmania.py):

    logit(public share for team A) = slope * logit(team A's win chance)

with no intercept, since which team is listed first is arbitrary. One slope
per scoring format. `python crowd_model.py bowlmania.json` refits and checks,
leaving each season out, how sheets built from the estimate do against the
real crowd.

Result (Nov 15, 2026):
- The estimate misses the real share by about 15-17 points on average.
- Sheets tuned to the estimate did worse than plain chalk: in 25-person mixed
  confidence pools, an 18-23% chance of finishing first against chalk's
  26-34%.
- What the public gets wrong (which teams it loves or fades) isn't in the
  line.

So the daily job never tunes against an estimate. With no real pick data it
publishes the chalk sheet and says so.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bowl_engine as engine  # noqa: E402

# Fitted on 2022-2025 (177 bowls). Kept for reference only: not used to tune sheets.
CROWD_SLOPES = {"straight": 1.355, "confidence": 1.605}


def logit(x):
    x = np.clip(x, 0.01, 0.99)
    return np.log(x / (1 - x))


def estimate(p, scoring):
    """Estimated public share picking team A, from team A's win chance."""
    slope = CROWD_SLOPES[scoring]
    return 1 / (1 + np.exp(-slope * logit(np.asarray(p))))


def fit_slope(p, q):
    """Least squares through the origin on the logit scale."""
    x, y = logit(p), logit(q)
    return float((x * y).sum() / (x * x).sum())


def main(path):
    sys.path.insert(0, os.path.dirname(__file__))
    from bowl_backtest import load_seasons
    seasons = load_seasons(path)
    p_all = np.concatenate([s["p"] for s in seasons.values()])
    rng = np.random.default_rng(11)
    for scoring, key in (("straight", "q_straight"), ("confidence", "q_confidence")):
        q_all = np.concatenate([s[key] for s in seasons.values()])
        slope = fit_slope(p_all, q_all)
        err = np.abs(1 / (1 + np.exp(-slope * logit(p_all))) - q_all)
        print(f"{scoring}: slope {slope:.3f}; mean miss {err.mean():.3f}, 90th pct {np.percentile(err, 90):.3f} "
              f"(share points); naive 'public = line' miss {np.abs(p_all - q_all).mean():.3f}")
        confidence = scoring == "confidence"
        for season, s in seasons.items():
            rest_p = np.concatenate([t["p"] for k, t in seasons.items() if k != season])
            rest_q = np.concatenate([t[key] for k, t in seasons.items() if k != season])
            held_slope = fit_slope(rest_p, rest_q)
            p, q = s["p"], s[key]
            q_hat = 1 / (1 + np.exp(-held_slope * logit(p)))
            # Build a sheet from the estimate and from the real shares; judge both against the real crowd.
            row = []
            for crowd in (q, q_hat):
                sheet = engine.tune(p, crowd, 25, confidence, rng, sims=800, pool_type="mixed")
                outcomes, rival = engine.simulate_rivals(p, q, 25, 3000, confidence, rng, **engine.POOL_TYPES["mixed"])
                row.append(engine.win_rate(*sheet, outcomes, rival))
            chalk = engine.win_rate(*engine.chalk(p, confidence), outcomes, rival)
            print(f"  {season}: 25-person mixed pool, chance of first: real crowd {row[0]:.3f}, "
                  f"estimated crowd {row[1]:.3f}, chalk {chalk:.3f}")


if __name__ == "__main__":
    main(sys.argv[1])
