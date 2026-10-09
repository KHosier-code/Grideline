"""Replays this season's completed weeks with the current models, walk-forward.

For every completed week W of the current season, the TD model and the game
model are refit on data from before week W only, then used to rank that week's
players and pick that week's winners. The results are graded and sent to the
site as a "replay" report, which the Model Performance page labels as replayed
(made after the games, never shown as live picks).

Usage: python replay.py TD_DATASET GAMES_PARQUET [OUT.json]
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TD_DATASET, GAMES, OUT = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None
here = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(here, "td-model", "features.py")).read())  # defines ALL (TD model features)
GAME_RATING = ["epa_edge", "pass_edge", "rush_edge", "success_edge", "qb_edge", "qb_cpoe_edge", "qb_new_edge",
               "rest_diff", "hfa", "div_game"]

td = pd.read_parquet(TD_DATASET)
for p in ["QB", "RB", "WR", "TE"]:
    td[f"pos_{p}"] = (td.position == p).astype(int)
played = td[(td.upcoming == 0) & (td.prior_games >= 1) & td.implied.notna() & (td.season >= 2020)]
season = int(played.season.max())
# Live picks started in week 4 of 2026. Weeks from there on have real,
# timestamped picks, so they are never replayed (a replay would only show
# hindsight-friendly numbers next to the real ones). A new season is live
# from week 1 and has nothing to replay.
LIVE_FROM_WEEK = {2026: 4}
live_from = LIVE_FROM_WEEK.get(season, 1)
weeks = sorted(int(w) for w in played[played.season == season].week.unique() if int(w) < live_from)
print(f"{season}: replaying weeks {weeks or 'none'} (live picks from week {live_from})")

games = pd.read_parquet(GAMES)
games["hfa"] = 1 - games.neutral
game_hist = games[games.played & (games.season >= 2020)].dropna(subset=GAME_RATING)


def before(frame, week):
    return frame[(frame.season < season) | ((frame.season == season) & (frame.week < week))]


replay_weeks = []
for week in weeks:
    # --- TD picks -----------------------------------------------------------
    model = SeedAveragedGBM()
    train = before(played, week)
    model.fit(train[ALL], train.label)
    slate = played[(played.season == season) & (played.week == week)].copy()
    slate["probability"] = model.predict_proba(slate[ALL])[:, 1]
    top = slate.sort_values("probability", ascending=False).head(10)
    td_picks = [{
        "name": r.name, "position": r.position, "team": r.team, "opponent": r.opponent,
        "probability": round(float(r.probability), 4), "scored": bool(r.label),
    } for r in top.itertuples()]

    # --- Game winners -------------------------------------------------------
    g_train = before(game_hist, week)
    rating = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(g_train[GAME_RATING], g_train.margin)
    winner = LogisticRegression(fit_intercept=False, max_iter=2000).fit(
        rating.predict(g_train[GAME_RATING]).reshape(-1, 1), (g_train.margin > 0).astype(int))
    g_week = game_hist[(game_hist.season == season) & (game_hist.week == week)].copy()
    g_week["margin_pred"] = rating.predict(g_week[GAME_RATING])
    g_week["home_win"] = winner.predict_proba(g_week.margin_pred.values.reshape(-1, 1))[:, 1]
    game_rows = []
    for r in g_week.sort_values("game_id").itertuples():
        pick = r.home_team if r.margin_pred > 0 else r.away_team
        favorite = None
        if pd.notna(r.spread_line) and r.spread_line != 0:
            favorite = r.home_team if r.spread_line > 0 else r.away_team
        elif pd.notna(r.home_moneyline) and pd.notna(r.away_moneyline) and r.home_moneyline != r.away_moneyline:
            favorite = r.home_team if r.home_moneyline < r.away_moneyline else r.away_team
        won = None if r.margin == 0 else (r.home_team if r.margin > 0 else r.away_team)
        game_rows.append({
            "home": r.home_team, "away": r.away_team, "homeScore": int(r.home_score), "awayScore": int(r.away_score),
            "pick": pick, "pickProbability": round(float(max(r.home_win, 1 - r.home_win)), 3),
            "gridlineLine": round(float(-r.margin_pred), 1), "vegasFavorite": favorite,
            "correct": None if won is None else pick == won,
            "favoriteCorrect": None if won is None or favorite is None else favorite == won,
        })
    decided = [g for g in game_rows if g["correct"] is not None]
    fav_decided = [g for g in game_rows if g["favoriteCorrect"] is not None]
    replay_weeks.append({
        "week": week,
        "touchdowns": {"picks": td_picks, "hits": sum(p["scored"] for p in td_picks)},
        "games": game_rows,
        "winners": {"wins": sum(g["correct"] for g in decided), "losses": sum(not g["correct"] for g in decided)},
        "favorite": {"wins": sum(g["favoriteCorrect"] for g in fav_decided),
                     "losses": sum(not g["favoriteCorrect"] for g in fav_decided)},
    })
    w = replay_weeks[-1]
    print(f"{season} week {week}: TD top 10 {w['touchdowns']['hits']}/10, winners "
          f"{w['winners']['wins']}-{w['winners']['losses']} (Vegas favorite {w['favorite']['wins']}-{w['favorite']['losses']})")

report = {
    "season": season,
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "method": "Each week was replayed with models refit on data from before that week only.",
    "weeks": replay_weeks,
}
if OUT:
    json.dump(report, open(OUT, "w"), indent=1)

if not replay_weeks:
    print("No pre-live weeks to replay: not sending.")
    sys.exit(0)
origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
    sys.exit(0)
body = json.dumps({"kind": "replay", "season": season, "week": weeks[-1] if weeks else 0,
                   "generatedAt": report["generatedAt"], "payload": report}).encode()
request = urllib.request.Request(f"{origin.rstrip('/')}/api/reports/ingest", data=body, method="POST", headers={
    "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "gridline-replay"})
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("Sent:", response.status, response.read().decode()[:200])
except urllib.error.HTTPError as error:
    print(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
    sys.exit(1)
