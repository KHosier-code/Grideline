"""Project the next week's games with the QB-adjusted rating and send them to the site.

Usage: publish_games.py <games.parquet> <metrics.json>
Environment: GRIDLINE_INGEST_URL (site origin, e.g. https://gridelineanalytics.com)
             GRIDLINE_INGEST_TOKEN
Without both, the payload is written to games_payload.json instead.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

GAMES, METRICS = sys.argv[1], sys.argv[2]
MODEL_VERSION = "gridline-qb-rating-v1"
RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
          "rest_diff", "hfa", "div_game"]
TOTAL = ["pace_sum", "home_off_epa", "away_off_epa", "home_def_epa", "away_def_epa", "home_qb_value",
         "away_qb_value", "dome", "wind", "temp"]

df = pd.read_parquet(GAMES)
df["hfa"] = 1 - df.neutral
history = df[df.played & (df.season >= 2020)].dropna(subset=RATING + TOTAL)
rating = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(history[RATING], history.margin)
winner = LogisticRegression(max_iter=2000).fit(rating.predict(history[RATING]).reshape(-1, 1), (history.margin > 0).astype(int))
totals = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(history[TOTAL], history.total)

current = df.season.max()
upcoming = df[(df.season == current) & ~df.played & (df.game_type == "REG")]
if upcoming.empty:
    print("No upcoming regular-season games; nothing to publish.")
    sys.exit(0)
week = int(upcoming.week.min())
slate = upcoming[upcoming.week == week].dropna(subset=RATING + TOTAL).copy()
slate["margin_pred"] = rating.predict(slate[RATING])
slate["total_pred"] = totals.predict(slate[TOTAL])
slate["home_win"] = winner.predict_proba(slate.margin_pred.values.reshape(-1, 1))[:, 1]
eastern = ZoneInfo("America/New_York")


def r(value, digits=3):
    return None if value is None or pd.isna(value) else round(float(value), digits)


def qb(row, side):
    return {"name": row[f"{side}_qb_name"] if isinstance(row[f"{side}_qb_name"], str) else None,
            "value": r(row[f"{side}_qb_value"]), "listed": bool(row[f"{side}_qb_listed"]),
            "newStarter": bool(row[f"{side}_qb_new"])}


games = []
for _, row in slate.iterrows():
    games.append({
        "gameId": str(int(row.espn)) if pd.notna(row.espn) else row.game_id,
        "nflverseGameId": row.game_id,
        "homeTeam": row.home_team, "awayTeam": row.away_team,
        "kickoff": row.kickoff.tz_localize(eastern).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "projectedMargin": r(row.margin_pred, 2), "projectedTotal": r(row.total_pred, 2),
        "homeWinProbability": r(row.home_win, 4),
        "homeQb": qb(row, "home"), "awayQb": qb(row, "away"),
        "factors": {"qbEdge": r(row.qb_edge), "teamEdge": r(row.epa_edge), "passEdge": r(row.pass_edge),
                    "rushEdge": r(row.rush_edge), "restDiff": r(row.rest_diff, 0), "neutralSite": bool(row.neutral)},
    })

metrics = json.load(open(METRICS))
metrics.pop("seasons", None)
payload = {"season": int(current), "week": week, "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
           "modelVersion": MODEL_VERSION, "evaluation": metrics, "games": games}
print(f"{current} week {week}: {len(games)} games projected")
for game in games:
    fav = game["homeTeam"] if game["projectedMargin"] > 0 else game["awayTeam"]
    print(f"  {game['awayTeam']} ({game['awayQb']['name']}) at {game['homeTeam']} ({game['homeQb']['name']}): "
          f"{fav} by {abs(game['projectedMargin']):.1f}, total {game['projectedTotal']:.1f}")

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    json.dump(payload, open("games_payload.json", "w"), indent=1)
    print("GRIDLINE_INGEST_URL/TOKEN not set: wrote games_payload.json instead of sending.")
    sys.exit(0)
request = urllib.request.Request(f"{origin.rstrip('/')}/api/games/projections/ingest", data=json.dumps(payload).encode(),
                                 method="POST", headers={"Content-Type": "application/json",
                                                         "Authorization": f"Bearer {token}", "User-Agent": "gridline-game-model"})
with urllib.request.urlopen(request, timeout=60) as response:
    print("Sent:", response.status, response.read().decode()[:200])
