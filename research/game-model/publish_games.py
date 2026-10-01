"""Project the upcoming week's games (and next week's once this one is under way) with the QB-adjusted rating and send them to the site.

Usage: publish_games.py <games.parquet> <metrics.json> [team_stats.parquet]
Environment: GRIDLINE_INGEST_URL (site origin, e.g. https://gridelineanalytics.com)
             GRIDLINE_INGEST_TOKEN
Payloads are always written to games_payload_week<N>.json; without both variables they are not sent.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

GAMES, METRICS = sys.argv[1], sys.argv[2]
TEAMS_SNAPSHOT = GAMES.replace(".parquet", "_teams.parquet")
TEAM_STATS = sys.argv[3] if len(sys.argv) > 3 else None
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
# Once Sunday's games are final and only Monday night is left, next week's
# opening lines are already up, so project next week too: the opener-gap watch
# list compares our line with the opener, and the sooner we publish the closer
# the bettable line still is to it. Waiting for Sunday's results keeps the
# ratings as complete as the ones the watch list was back-tested with.
this_week = df[(df.season == current) & (df.week == week)]
left = this_week[~this_week.played]
in_progress = bool(this_week.played.any()) and bool(pd.to_datetime(left.kickoff).dt.dayofweek.isin([0, 1]).all())
weeks = [week] + ([week + 1] if in_progress and (upcoming.week == week + 1).any() else [])
slate = upcoming[upcoming.week.isin(weeks)].dropna(subset=RATING + TOTAL).copy()
slate["margin_pred"] = rating.predict(slate[RATING])
slate["total_pred"] = totals.predict(slate[TOTAL])
slate["home_win"] = winner.predict_proba(slate.margin_pred.values.reshape(-1, 1))[:, 1]
eastern = ZoneInfo("America/New_York")


def r(value, digits=3):
    return None if value is None or pd.isna(value) else round(float(value), digits)


def qb(row, side):
    return {"name": row[f"{side}_qb_name"] if isinstance(row[f"{side}_qb_name"], str) else None,
            "value": r(row[f"{side}_qb_value"]), "listed": bool(row[f"{side}_qb_listed"]),
            "newStarter": bool(row[f"{side}_qb_new"]),
            "outName": row.get(f"{side}_qb_out_name") if isinstance(row.get(f"{side}_qb_out_name"), str) else None,
            "outReason": row.get(f"{side}_qb_out_reason") if isinstance(row.get(f"{side}_qb_out_reason"), str) else None}


games = []
for _, row in slate.iterrows():
    games.append({
        "week": int(row.week),
        "gameId": str(int(row.espn)) if pd.notna(row.espn) else row.game_id,
        "nflverseGameId": row.game_id,
        "homeTeam": row.home_team, "awayTeam": row.away_team,
        "kickoff": row.kickoff.tz_localize(eastern).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "projectedMargin": r(row.margin_pred, 2), "projectedTotal": r(row.total_pred, 2),
        "homeWinProbability": r(row.home_win, 4),
        # nflverse's consensus line (expected home margin), a fallback when no
        # sportsbook capture exists yet.
        "marketMargin": r(row.spread_line, 1), "marketTotal": r(row.total_line, 1),
        "homeQb": qb(row, "home"), "awayQb": qb(row, "away"),
        "factors": {"qbEdge": r(row.qb_edge), "teamEdge": r(row.epa_edge), "passEdge": r(row.pass_edge),
                    "rushEdge": r(row.rush_edge), "restDiff": r(row.rest_diff, 0), "neutralSite": bool(row.neutral)},
    })


# ---------------------------------------------------------------- power ratings
# A team's rating is its projected margin against a league-average team on a
# neutral field with its expected starting QB. The model is linear, so the
# offense and defense parts add up to the total.
teams = pd.read_parquet(TEAMS_SNAPSHOT)
average = teams[["off_epa", "off_pass_epa", "off_rush_epa", "off_success", "def_epa", "def_pass_epa", "def_rush_epa",
                 "def_success", "qb_value", "qb_cpoe"]].mean()


def vector(row, offense=True, defense=True, qb=True):
    o = (lambda name: row[f"off_{name}"] - average[f"off_{name}"]) if offense else (lambda name: 0.0)
    d = (lambda name: row[f"def_{name}"] - average[f"def_{name}"]) if defense else (lambda name: 0.0)
    return pd.DataFrame([{
        "epa_edge": o("epa") - d("epa"), "pass_edge": o("pass_epa") - d("pass_epa"),
        "rush_edge": o("rush_epa") - d("rush_epa"), "success_edge": o("success") - d("success"),
        "qb_edge": (row.qb_value - average.qb_value) if qb else 0.0,
        "qb_cpoe_edge": ((row.qb_cpoe if pd.notna(row.qb_cpoe) else average.qb_cpoe) - average.qb_cpoe) if qb else 0.0,
        "qb_new_edge": 0, "rest_diff": 0, "hfa": 0, "div_game": 0,
    }])[RATING]


baseline = float(rating.predict(vector(teams.iloc[0], False, False, False))[0])
team_rows = []
for _, row in teams.iterrows():
    total = float(rating.predict(vector(row))[0]) - baseline
    offense = float(rating.predict(vector(row, True, False, False))[0]) - baseline
    defense = float(rating.predict(vector(row, False, True, False))[0]) - baseline
    qb_part = total - offense - defense
    team_rows.append({"team": row.team, "rating": round(total, 2), "offense": round(offense, 2),
                      "defense": round(defense, 2), "qb": round(qb_part, 2),
                      "qbName": row.qb_name if isinstance(row.qb_name, str) else None,
                      "qbValue": r(row.qb_value), "qbNewStarter": bool(row.qb_new),
                      "qbOutName": row.qb_out_name if isinstance(getattr(row, "qb_out_name", None), str) else None,
                      "qbOutReason": row.qb_out_reason if isinstance(getattr(row, "qb_out_reason", None), str) else None})
ratings = pd.DataFrame(team_rows)
for column in ("rating", "offense", "defense", "qb"):
    ratings[f"{column}Rank"] = ratings[column].rank(ascending=False, method="min").astype(int)
if TEAM_STATS and os.path.exists(TEAM_STATS):
    stats = pd.read_parquet(TEAM_STATS).set_index("team")
else:
    stats = pd.DataFrame()
team_payload = []
for row in ratings.sort_values("rating", ascending=False).to_dict("records"):
    # pandas stores missing text as NaN, which is not valid JSON.
    entry = {key: (None if isinstance(value, float) and np.isnan(value) else value) for key, value in row.items()}
    if row["team"] in stats.index:
        s_row = stats.loc[row["team"]]
        entry["record"] = {"wins": int(s_row.wins), "losses": int(s_row.losses), "ties": int(s_row.ties)}
        entry["stats"] = {key: (None if pd.isna(value) else (int(value) if key.endswith("_rank") else round(float(value), 4)))
                          for key, value in s_row.items() if key.startswith(("off_", "def_"))}
    else:
        entry["record"] = None
        entry["stats"] = {}
    team_payload.append(entry)

metrics = json.load(open(METRICS))
# Per-season test results, for the Model Performance page.
metrics["seasons"] = [{key: value for key, value in row.items() if not key.startswith(("ats_market", "ou_"))}
                      for row in metrics.get("seasons", [])]
for row in metrics["seasons"]:
    wins, losses, pushes, rate = row.pop("ats_rating")
    row.update({"ats_wins": wins, "ats_losses": losses, "ats_pushes": pushes})
generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
payloads = [{"season": int(current), "week": w, "generatedAt": generated_at, "modelVersion": MODEL_VERSION,
             "evaluation": metrics, "games": [{key: value for key, value in game.items() if key != "week"}
                                              for game in games if game["week"] == w],
             # Power ratings go with the current week only, so rank changes compare with last week.
             "teams": team_payload if w == week else []} for w in weeks]
for team in team_payload[:8]:
    print(f"  #{team['ratingRank']:>2} {team['team']:<3} {team['rating']:+.1f} (off {team['offense']:+.1f}, def {team['defense']:+.1f}, QB {team['qbName']} {team['qb']:+.1f})")
for payload in payloads:
    print(f"{current} week {payload['week']}: {len(payload['games'])} games projected, {len(team_payload)} teams rated")
    for game in payload["games"]:
        fav = game["homeTeam"] if game["projectedMargin"] > 0 else game["awayTeam"]
        print(f"  {game['awayTeam']} ({game['awayQb']['name']}) at {game['homeTeam']} ({game['homeQb']['name']}): "
              f"{fav} by {abs(game['projectedMargin']):.1f}, total {game['projectedTotal']:.1f}")
    # Kept for the receipts branch (see .github/workflows/weekly-picks.yml) and for inspecting a run.
    json.dump(payload, open(f"games_payload_week{payload['week']}.json", "w"), indent=1)

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: wrote games_payload_week*.json instead of sending.")
    sys.exit(0)
for payload in payloads:
    request = urllib.request.Request(f"{origin.rstrip('/')}/api/games/projections/ingest", data=json.dumps(payload).encode(),
                                     method="POST", headers={"Content-Type": "application/json",
                                                             "Authorization": f"Bearer {token}", "User-Agent": "gridline-game-model"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            print(f"Sent week {payload['week']}:", response.status, response.read().decode()[:200])
    except urllib.error.HTTPError as error:
        print(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
        sys.exit(1)
