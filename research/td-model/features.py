USAGE = ["l3_targets", "l8_targets", "l3_carries", "l8_carries", "tgt_share8", "car_share8", "tgt_share3",
         "car_share3", "l8_receiving_yards", "l8_rushing_yards", "l8_receptions", "prior_games", "same_team_prev"]
REDZONE = ["l8_rz20_tgt", "l8_rz20_car", "l8_rz10_tgt", "l8_rz10_car", "l8_rz5_tgt", "l8_rz5_car",
           "rz20_tgt_share8", "rz20_car_share8", "rz10_car_share8", "rz5_car_share8", "rz5_tgt_share8",
           "rz_opps8", "gl_opps8", "rz_opps17", "implied_share_rz"]
HISTORY = ["td_rate_shrunk", "l8_tds", "l17_label"]
DEFENSE = ["opp_pos_tds8_shrunk", "opp_pos_tds_ratio", "opp_rz_allowed8"]
CONTEXT = ["implied", "opp_implied", "is_home", "team_rz_pg8"]
POS = ["pos_QB", "pos_RB", "pos_WR", "pos_TE"]
GROUPS = {"usage": USAGE, "redzone": REDZONE, "history": HISTORY, "defense": DEFENSE, "context": CONTEXT}
ALL = USAGE + REDZONE + HISTORY + DEFENSE + CONTEXT + POS



class SeedAveragedGBM:
    """The live TD model: gradient boosting fit with several random seeds, probabilities averaged.

    A single seed moved the walk-forward top-5 hit rate by about 3 points
    (2021-2026: 52.9% to 56.1% across five seeds), because the model holds out
    a random slice of training rows for early stopping. Averaging the seeds
    removes that luck from the weekly board.
    """

    SEEDS = (1, 7, 42, 99, 123)

    def __init__(self, seeds=SEEDS):
        self.seeds = tuple(seeds)
        self.models = []

    def fit(self, X, y):
        from sklearn.ensemble import HistGradientBoostingClassifier
        self.models = [HistGradientBoostingClassifier(max_iter=400, learning_rate=0.03, max_leaf_nodes=15,
                                                      min_samples_leaf=80, l2_regularization=1.0,
                                                      random_state=seed).fit(X, y) for seed in self.seeds]
        return self

    def predict_proba(self, X):
        return sum(model.predict_proba(X) for model in self.models) / len(self.models)
