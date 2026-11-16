"""python -m unittest research/pools/test_bowl_engine.py (from the repo root, or run directly)."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bowl_engine as engine  # noqa: E402


class BowlEngineTest(unittest.TestCase):
    def test_win_chance_removes_the_cut(self):
        self.assertAlmostEqual(engine.win_chance(-110, -110), 0.5)
        p = engine.win_chance(-200, 170)
        self.assertTrue(0.63 < p < 0.66)
        self.assertAlmostEqual(engine.win_chance(-200, 170) + engine.win_chance(170, -200), 1.0)
        self.assertAlmostEqual(engine.spread_win_chance(0), 0.5)
        self.assertGreater(engine.spread_win_chance(-7), 0.65)

    def test_chalk_picks_favorites_and_ranks_points_by_certainty(self):
        p = np.array([0.55, 0.2, 0.9, 0.7])
        picks, points = engine.chalk(p, True)
        self.assertEqual(picks.tolist(), [True, False, True, True])
        self.assertEqual(points.tolist(), [1.0, 3.0, 4.0, 2.0])
        picks, points = engine.chalk(p, False)
        self.assertEqual(points.tolist(), [1.0] * 4)

    def test_ties_are_split_with_every_rival_who_shares_first(self):
        outcomes = np.array([[True, True]])
        rival = (np.array([2.0]), np.array([3]))
        self.assertAlmostEqual(engine.win_rate(np.array([True, True]), np.ones(2), outcomes, rival), 0.25)

    def test_opponents_pick_like_the_public(self):
        rng = np.random.default_rng(1)
        p = np.array([0.7, 0.4]); q = np.array([0.8, 0.3])
        picks, _ = engine.opponents(p, q, 50, 400, False, rng)
        self.assertAlmostEqual(picks[..., 0].mean(), 0.8, delta=0.02)
        picks, _ = engine.opponents(p, q, 50, 400, False, rng, sharp=0.2)
        self.assertAlmostEqual(picks[:, :10, 0].mean(), 0.9, delta=0.03)  # the sharp fifth follow the favorite

    def test_a_crowd_backing_underdogs_makes_chalk_beat_its_fair_share(self):
        rng = np.random.default_rng(2)
        p = np.full(20, 0.7); q = np.full(20, 0.4)  # favorites win 70%, but only 40% pick them
        sheet = engine.build_sheet(p, q, 25, True, rng, pool_type="casual", sims=400, check_sims=1000)
        self.assertGreater(sheet["chalk_win"], 3 * sheet["fair"])
        self.assertGreaterEqual(sheet["win"], sheet["chalk_win"] - 0.05)


if __name__ == "__main__":
    unittest.main()
