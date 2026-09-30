"""Rank the next week's anytime-TD candidates and send them to the site.

Usage: publish.py <dataset.parquet> <data dir> <metrics.json>
Environment:
  GRIDLINE_INGEST_URL    site origin, e.g. https://gridelineanalytics.com
  GRIDLINE_INGEST_TOKEN  shared secret (same value as the site's secret)
Without both variables the payload is written to td_payload.json and not sent.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

DATASET, DATA, METRICS = sys.argv[1], sys.argv[2], sys.argv[3]
MODEL_VERSION = "gridline-td-gbm-v3"
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "features.py")).read())

df = pd.read_parquet(DATASET)
for p in ["QB", "RB", "WR", "TE"]:
    df[f"pos_{p}"] = (df.position == p).astype(int)
history = df[(df.upcoming == 0) & (df.prior_games >= 1) & df.implied.notna()]
model = HistGradientBoostingClassifier(max_iter=400, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=80,
                                       l2_regularization=1.0, random_state=7).fit(history[ALL], history.label)

upcoming = df[(df.upcoming == 1) & (df.prior_games >= 1) & df.implied.notna()].copy()
if upcoming.empty:
    print("No upcoming week with lines; nothing to publish.")
    sys.exit(0)
season, week = int(upcoming.season.iloc[0]), int(upcoming.week.iloc[0])

# Availability: active roster for this week, then this week's injury report if it exists.
rosters = pd.read_parquet(f"{DATA}/rosters_{season}.parquet")
active = rosters[(rosters.week == week) & (rosters.status == "ACT")].gsis_id
if len(active):
    upcoming = upcoming[upcoming.player_id.isin(set(active))]
injuries = pd.read_parquet(f"{DATA}/injuries_{season}.parquet")
this_week = injuries[injuries.week == week][["gsis_id", "report_status"]]
if len(this_week):
    status = dict(zip(this_week.gsis_id, this_week.report_status))
    upcoming["injury"] = upcoming.player_id.map(status)
    upcoming = upcoming[upcoming.injury != "Out"]
else:
    last = injuries[injuries.week == week - 1]
    out_last_week = set(last[last.report_status.isin(["Out", "Doubtful"])].gsis_id)
    upcoming["injury"] = np.where(upcoming.player_id.isin(out_last_week), "Out last week", None)

upcoming["probability"] = model.predict_proba(upcoming[ALL])[:, 1]

games = pd.read_csv(f"{DATA}/games.csv")
games = games[(games.season == season) & (games.game_type == "REG")]
eastern = ZoneInfo("America/New_York")


def kickoff(row):
    try:
        local = datetime.strptime(f"{row.gameday} {row.gametime}", "%Y-%m-%d %H:%M").replace(tzinfo=eastern)
        return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError):
        return None


kickoffs = {row.game_id: kickoff(row) for row in games.itertuples()}


def num(value, digits=3):
    return None if value is None or pd.isna(value) else round(float(value), digits)


picks = []
for row in upcoming.sort_values("probability", ascending=False).itertuples():
    picks.append({
        "playerId": row.player_id,
        "name": row.name,
        "position": row.position,
        "team": row.team,
        "opponent": row.opponent,
        "isHome": bool(row.is_home),
        "kickoff": kickoffs.get(row.game_id),
        "probability": round(float(row.probability), 4),
        "injuryStatus": row.injury if isinstance(row.injury, str) else None,
        "factors": {
            "targetsPerGame": num(row.l8_targets, 2),
            "carriesPerGame": num(row.l8_carries, 2),
            "targetShare": num(row.tgt_share8),
            "carryShare": num(row.car_share8),
            "redZoneTouchesPerGame": num(row.rz_opps8, 2),
            "redZoneShare": num(max(row.rz20_tgt_share8 if pd.notna(row.rz20_tgt_share8) else 0,
                                    row.rz20_car_share8 if pd.notna(row.rz20_car_share8) else 0)),
            "goalLineShare": num(row.rz5_car_share8),
            "teamImpliedPoints": num(row.implied, 1),
            "opponentTdsAllowedRatio": num(row.opp_pos_tds_ratio, 2),
            "recentTdRate": num(row.td_rate_shrunk),
        },
    })

# Results for the two most recent completed weeks, so the site can grade picks.
played = df[(df.upcoming == 0) & (df.season == season)]
recent_weeks = sorted(played.week.unique())[-2:]
results = [{"season": season, "week": int(r.week), "playerId": r.player_id, "scored": bool(r.label)}
           for r in played[played.week.isin(recent_weeks)].itertuples()]

payload = {
    "season": season,
    "week": week,
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "modelVersion": MODEL_VERSION,
    "evaluation": json.load(open(METRICS)),
    "picks": picks,
    "results": results,
}
print(f"{season} week {week}: {len(picks)} players ranked, {len(results)} results for weeks {[int(w) for w in recent_weeks]}")
for pick in picks[:10]:
    print(f"  {pick['probability']:.1%}  {pick['name']} ({pick['position']}, {pick['team']} vs {pick['opponent']})")

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    json.dump(payload, open("td_payload.json", "w"), indent=1)
    print("GRIDLINE_INGEST_URL/TOKEN not set: wrote td_payload.json instead of sending.")
    sys.exit(0)
url = f"{origin.rstrip('/')}/api/touchdowns/ingest"
request = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={
    "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "gridline-td-model"})
with urllib.request.urlopen(request, timeout=60) as response:
    print("Sent:", response.status, response.read().decode()[:200])
