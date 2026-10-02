import json
import sys
import pandas as pd

sys.argv += []
DATASET, DATA, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
exec(open(__file__.replace("predict_week.py", "features.py")).read())

df = pd.read_parquet(DATASET)
for p in ["QB", "RB", "WR", "TE"]:
    df[f"pos_{p}"] = (df.position == p).astype(int)
hist = df[(df.upcoming == 0) & (df.prior_games >= 1) & df.implied.notna() & df.season.between(2020, 2026)]
model = SeedAveragedGBM().fit(hist[ALL], hist.label)

up = df[(df.upcoming == 1) & (df.prior_games >= 1)].copy()
season, week = int(up.season.iloc[0]), int(up.week.iloc[0])

# Availability: must be on the active roster for this week; flag anyone listed Out/Doubtful last week.
rost = pd.read_parquet(f"{DATA}/rosters_{season}.parquet")
rost = rost[rost.week == week][["gsis_id", "status"]].rename(columns={"gsis_id": "player_id", "status": "roster_status"})
up = up.merge(rost, on="player_id", how="left")
inj = pd.read_parquet(f"{DATA}/injuries_{season}.parquet")
last = inj[inj.week == inj.week.max()][["gsis_id", "report_status"]].rename(columns={"gsis_id": "player_id", "report_status": "last_injury_status"})
up = up.merge(last, on="player_id", how="left")
up = up[up.roster_status == "ACT"].copy()

up["probability"] = model.predict_proba(up[ALL])[:, 1]
up["fair_odds"] = up.probability.map(lambda p: round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p))
up["rz_touches_pg"] = up.rz_opps8
up["goal_line_share"] = up.rz5_car_share8
cols = ["name", "position", "team", "opponent", "is_home", "probability", "fair_odds", "implied", "l8_targets",
        "l8_carries", "tgt_share8", "car_share8", "rz_touches_pg", "l8_rz10_tgt", "l8_rz10_car", "goal_line_share",
        "rz20_tgt_share8", "rz20_car_share8", "td_rate_shrunk", "l8_tds", "opp_pos_tds_ratio", "opp_pos_tds8_shrunk",
        "last_injury_status", "game_id"]
ranked = up.sort_values("probability", ascending=False)[cols]
ranked.to_json(OUT, orient="records", indent=1)
pd.set_option("display.width", 220)
show = ranked.head(30).copy()
show["probability"] = (show.probability * 100).round(1)
print(f"{season} week {week}: {len(ranked)} active candidates")
print(show[["name", "position", "team", "opponent", "probability", "fair_odds", "implied", "rz_touches_pg", "goal_line_share",
            "tgt_share8", "car_share8", "opp_pos_tds_ratio", "last_injury_status"]].round(2).to_string(index=False))
