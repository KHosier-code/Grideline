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

