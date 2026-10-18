"""Daily college basketball run: power ratings, today's and tomorrow's games,
and spread picks, sent to the site.

Usage: python daily.py DATA_DIR CACHE_DIR [OUT_JSON]

  DATA_DIR   past seasons from sportsdataverse (team_box, mbb_schedule and
             player_box parquet files, see fetch_data.sh)
  CACHE_DIR  box scores of this season's finished games, kept between runs
             (each game is read from ESPN once)

Steps, all from free ESPN data:
  1. Last season's final ratings, and the roster-turnover prior regression
     fit on every earlier season (see roster.py).
  2. This season's rosters from ESPN team pages -> each team's preseason
     prior (returning production and transfers).
  3. This season's finished games -> ratings refit with that prior.
  4. Today's and tomorrow's games: our margin and total against the
     sportsbook line ESPN shows. A pick is a spread where we disagree with
     the current line by 2+ points (the 2025-26 test: 52-54% against
     opening lines, and lines moved our way about twice as often as against).
  5. Finals from the last few days, so the site can grade earlier picks.

The site keeps every run. A pick counts at the first run that showed it
before tip-off, at the line shown then.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from ratings import Params, Ratings, load_games
from roster import RosterPrior, design, player_seasons, turnover

BASE = Params(ridge=5.0)  # ridge 5 with the roster prior (backtest_roster.py)
PICK_EDGE = 2.0           # points of disagreement with the line for a pick
MARGIN_SD = 11.5          # spread of real margins around ours (MAE 9.2 x 1.25)
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
ET = timezone(timedelta(hours=-5))  # day boundaries only; an hour off in DST is fine


def get(url, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
        except Exception:
            pass
        time.sleep(2 ** attempt)
    return None


def season_for(day):
    """Seasons are named by the year they end: November 2026 is 2027."""
    return day.year + 1 if day.month >= 7 else day.year


# ---------------------------------------------------------------- ESPN reads

def d1_teams():
    data = get(f"{ESPN}/teams?limit=500&groups=50") or {}
    out = {}
    for item in data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", []):
        t = item["team"]
        logos = t.get("logos") or []
        out[str(t["id"])] = {"id": str(t["id"]), "name": t.get("location") or t.get("displayName"),
                             "short": t.get("shortDisplayName") or t.get("location"),
                             "abbr": t.get("abbreviation"), "logo": logos[0]["href"] if logos else None,
                             "color": t.get("color")}
    return out


def rosters(team_ids):
    def one(team_id):
        data = get(f"{ESPN}/teams/{team_id}/roster") or {}
        return [(str(a["id"]), team_id) for a in data.get("athletes", []) if a.get("id")]
    with ThreadPoolExecutor(8) as pool:
        rows = [row for chunk in pool.map(one, team_ids) for row in chunk]
    return pd.DataFrame(rows, columns=["athlete", "team"])


def scoreboard(day):
    data = get(f"{ESPN}/scoreboard?dates={day:%Y%m%d}&groups=50&limit=500") or {}
    games = []
    for event in data.get("events", []):
        comp = event["competitions"][0]
        sides = {c["homeAway"]: c for c in comp["competitors"]}
        if "home" not in sides or "away" not in sides:
            continue
        status = comp["status"]["type"]
        games.append({
            "id": str(event["id"]), "tip": event["date"], "neutral": bool(comp.get("neutralSite")),
            "state": status.get("state"), "completed": bool(status.get("completed")),
            "home": str(sides["home"]["team"]["id"]), "away": str(sides["away"]["team"]["id"]),
            "home_pts": float(sides["home"].get("score") or 0), "away_pts": float(sides["away"].get("score") or 0),
            "home_seed": (sides["home"].get("curatedRank") or {}).get("current"),
            "away_seed": (sides["away"].get("curatedRank") or {}).get("current"),
        })
    return games


def box(game_id):
    """Points and possessions for a finished game from its ESPN box score."""
    data = get(f"{ESPN}/summary?event={game_id}")
    if not data:
        return None
    sides = {}
    for team in data.get("boxscore", {}).get("teams", []):
        stats = {s["name"]: s.get("displayValue") for s in team.get("statistics", [])}
        try:
            fga = float(stats["fieldGoalsMade-fieldGoalsAttempted"].split("-")[1])
            fta = float(stats["freeThrowsMade-freeThrowsAttempted"].split("-")[1])
            oreb = float(stats["offensiveRebounds"])
            tov = float(stats.get("totalTurnovers") or stats["turnovers"])
        except (KeyError, ValueError, AttributeError, IndexError):
            return None
        sides[str(team["team"]["id"])] = fga - oreb + tov + 0.475 * fta
    return sides if len(sides) == 2 else None


def num(value):
    if value in (None, "", "OFF"):
        return None
    if value == "EVEN":
        return 100.0
    try:
        return float(str(value).lstrip("ou").replace("+", ""))
    except ValueError:
        return None


def line(game_id):
    """The sportsbook line ESPN shows for a game (home spread, total, openers)."""
    data = get(f"{ESPN}/summary?event={game_id}") or {}
    picks = data.get("pickcenter") or []
    if not picks:
        return None
    p = picks[0]
    spread = (p.get("pointSpread") or {}).get("home") or {}
    total = (p.get("total") or {}).get("over") or {}
    home_spread = num((spread.get("close") or {}).get("line"))
    home_spread = home_spread if home_spread is not None else num(p.get("spread"))
    total_now = num((total.get("close") or {}).get("line"))
    total_now = total_now if total_now is not None else num(p.get("overUnder"))
    if home_spread is None and total_now is None:
        return None
    return {"provider": (p.get("provider") or {}).get("name"), "homeSpread": home_spread,
            "homeSpreadOpen": num((spread.get("open") or {}).get("line")), "total": total_now,
            "totalOpen": num((total.get("open") or {}).get("line")),
            "homeMoneyline": num((p.get("homeTeamOdds") or {}).get("moneyLine")),
            "awayMoneyline": num((p.get("awayTeamOdds") or {}).get("moneyLine"))}


# ---------------------------------------------------------------- model

def history(data_dir, current):
    """Final ratings of each past season, player tables, and the prior regression.

    Past seasons use the default settings, as in backtest_roster.py; ridge 5 is
    only for the in-season fit on top of the roster prior.
    """
    first = min(int(f.split("_")[-1].split(".")[0]) for f in os.listdir(data_dir) if f.startswith("team_box_"))
    finals, players, prior, fitted = {}, {}, None, None
    for season in range(first, current):
        games = load_games(data_dir, season)
        teams = sorted(set(games.home) | set(games.away))
        fitted = Ratings(teams, prior, Params()).fit(games, games.date.max() + pd.Timedelta(days=1))
        finals[season] = prior = fitted.snapshot()
        players[season] = player_seasons(data_dir, season)
    X, off, dfn = [], [], []
    for season in range(first + 1, current):
        prev = finals[season - 1]
        net = {team: o - d for team, (o, d, _) in prev.items()}
        rows = design(prev, turnover(players[season - 1], players[season], net))
        target = pd.DataFrame(finals[season], index=["off", "def", "tempo"]).T.reindex(rows.index)
        keep = target.notna().all(axis=1)
        X.append(rows[keep]); off.append(target.off[keep]); dfn.append(target["def"][keep])
    model = RosterPrior().fit(pd.concat(X), pd.concat(off), pd.concat(dfn))
    # League averages (efficiency, home edge, tempo) carry over until this season's games replace them.
    return finals[current - 1], players[current - 1], model, (fitted.mu, fitted.hca, fitted.pace)


def current_games(season, teams, cache_dir, today):
    """This season's finished D-I vs D-I games, with possessions (cached)."""
    path = os.path.join(cache_dir, f"boxes_{season}.json")
    cache = json.load(open(path)) if os.path.exists(path) else {}
    start = datetime(season - 1, 11, 1).date()
    days = [start + timedelta(days=i) for i in range((today - start).days + 1)] if today >= start else []
    with ThreadPoolExecutor(8) as pool:
        boards = list(pool.map(scoreboard, days))
    finals = list({g["id"]: g for board in boards for g in board
                   if g["completed"] and g["home"] in teams and g["away"] in teams and g["home_pts"] + g["away_pts"] > 0}.values())
    missing = [g["id"] for g in finals if g["id"] not in cache]
    with ThreadPoolExecutor(8) as pool:
        for game_id, sides in zip(missing, pool.map(box, missing)):
            if sides:
                cache[game_id] = sides
    os.makedirs(cache_dir, exist_ok=True)
    json.dump(cache, open(path, "w"))
    rows = []
    for g in finals:
        sides = cache.get(g["id"])
        if not sides or g["home"] not in sides or g["away"] not in sides:
            continue
        rows.append({"game_id": g["id"], "date": pd.Timestamp(g["tip"]).tz_convert(None), "home": g["home"], "away": g["away"],
                     "neutral": g["neutral"], "home_pts": g["home_pts"], "away_pts": g["away_pts"],
                     "poss": (sides[g["home"]] + sides[g["away"]]) / 2})
    frame = pd.DataFrame(rows, columns=["game_id", "date", "home", "away", "neutral", "home_pts", "away_pts", "poss"])
    frame = frame[(frame.poss > 40) & (frame.poss < 110)] if len(frame) else frame
    return frame.sort_values("date").reset_index(drop=True), boards


def win_prob(margin):
    return 0.5 * (1 + math.erf(margin / (MARGIN_SD * math.sqrt(2))))


def ranks(values, descending=True):
    order = sorted(values, key=lambda k: -values[k] if descending else values[k])
    return {team: i + 1 for i, team in enumerate(order)}


def main(data_dir, cache_dir, out_path=None):
    now = datetime.now(timezone.utc)
    today = now.astimezone(ET).date()
    if 5 <= today.month <= 9:
        print("Off-season (May-September): nothing to send.")
        return
    season = season_for(today)
    teams = d1_teams()
    if len(teams) < 300:
        sys.exit(f"ESPN returned only {len(teams)} D-I teams; not sending.")
    print(f"{season} season, {len(teams)} D-I teams", flush=True)

    last, last_players, prior_model, league = history(data_dir, season)
    roster = rosters(sorted(teams))
    print(f"rosters: {len(roster)} players on {roster.team.nunique()} teams", flush=True)
    last_net = {team: o - d for team, (o, d, _) in last.items()}
    turn = turnover(last_players, roster.assign(minutes=0.0), last_net).reindex(sorted(teams)).fillna(0)
    X = design(last, turn)
    pred_off, pred_def = prior_model.predict(X)
    prior = {team: (o, d, last.get(team, (0, 0, 0))[2] * BASE.carryover) for team, o, d in zip(X.index, pred_off, pred_def)}

    games, boards = current_games(season, set(teams), cache_dir, today - timedelta(days=1))
    print(f"{len(games)} finished games this season", flush=True)
    model = Ratings(sorted(teams), prior, BASE, league=league).fit(games, pd.Timestamp(now).tz_convert(None))

    # Records from this season's finals.
    record = {team: [0, 0] for team in teams}
    for g in games.itertuples():
        winner, loser = (g.home, g.away) if g.home_pts > g.away_pts else (g.away, g.home)
        record[winner][0] += 1
        record[loser][1] += 1

    # Ratings table: net = points per 100 possessions better than average.
    snap = model.snapshot()
    net = {t: o - d for t, (o, d, _) in snap.items()}
    off = {t: o for t, (o, _, _) in snap.items()}
    dfn = {t: d for t, (_, d, _) in snap.items()}
    tempo = {t: model.pace + p for t, (_, _, p) in snap.items()}
    # Shown as points per 100 possessions against an average opponent.
    avg_off, avg_def = np.mean(list(off.values())), np.mean(list(dfn.values()))
    shown_off = {t: model.mu + o + avg_def for t, o in off.items()}
    shown_def = {t: model.mu + d + avg_off for t, d in dfn.items()}
    r_net, r_off, r_def, r_tempo = ranks(net), ranks(off), ranks(dfn, descending=False), ranks(tempo)
    prev_rank = ranks({t: o - d for t, (o, d, _) in prior.items()})
    team_rows = [{**teams[t], "rank": r_net[t], "preseasonRank": prev_rank[t], "net": round(net[t], 2),
                  "offense": round(shown_off[t], 1), "defense": round(shown_def[t], 1), "tempo": round(tempo[t], 1),
                  "offenseRank": r_off[t], "defenseRank": r_def[t], "tempoRank": r_tempo[t],
                  "wins": record[t][0], "losses": record[t][1]} for t in sorted(teams, key=lambda t: r_net[t])]

    # Today's and tomorrow's games.
    upcoming = [g for day in (today, today + timedelta(days=1)) for g in scoreboard(day)
                if g["state"] == "pre" and g["home"] in teams and g["away"] in teams]
    with ThreadPoolExecutor(8) as pool:
        lines = list(pool.map(line, [g["id"] for g in upcoming]))
    game_rows = []
    for g, ln in zip(upcoming, lines):
        hp, ap, pace = model.predict(g["home"], g["away"], g["neutral"])
        margin = hp - ap
        row = {"id": g["id"], "tip": g["tip"], "neutral": g["neutral"],
               "home": {"id": g["home"], "rank": r_net[g["home"]], "apRank": g["home_seed"] if g["home_seed"] and g["home_seed"] < 99 else None},
               "away": {"id": g["away"], "rank": r_net[g["away"]], "apRank": g["away_seed"] if g["away_seed"] and g["away_seed"] < 99 else None},
               "model": {"homeMargin": round(margin, 1), "total": round(hp + ap, 1), "homeWinProb": round(win_prob(margin), 3),
                         "homePoints": round(hp, 1), "awayPoints": round(ap, 1), "possessions": round(pace, 1)},
               "line": ln, "pick": None}
        if ln and ln["homeSpread"] is not None:
            edge = margin + ln["homeSpread"]  # >0: home beats the spread by this much
            if abs(edge) >= PICK_EDGE:
                side = "home" if edge > 0 else "away"
                row["pick"] = {"side": side, "team": g[side],
                               "line": ln["homeSpread"] if side == "home" else -ln["homeSpread"], "edge": round(abs(edge), 1)}
        game_rows.append(row)

    # Finals from the last four days, for grading.
    recent = {str(today - timedelta(days=i)) for i in range(1, 5)}
    results = list({g["id"]: {"id": g["id"], "homePoints": g["home_pts"], "awayPoints": g["away_pts"], "home": g["home"], "away": g["away"]}
                    for board in boards for g in board
                    if g["completed"] and str(pd.Timestamp(g["tip"]).tz_convert("America/New_York").date()) in recent}.values())

    payload = {"generatedAt": now.isoformat(timespec="seconds"), "season": season, "gamesPlayed": int(len(games)),
               "model": {"pickEdge": PICK_EDGE, "marginSd": MARGIN_SD, "homeCourt": round(2 * model.hca * model.pace / 100, 2),
                         "averageEfficiency": round(model.mu + avg_off + avg_def, 1), "averageTempo": round(model.pace, 1)},
               "teams": team_rows, "games": game_rows, "results": results,
               # Compact copy the site reads from every run to grade the record.
               "picks": [{"id": g["id"], "tip": g["tip"], "home": g["home"]["id"], "away": g["away"]["id"], **g["pick"]}
                         for g in game_rows if g["pick"]]}
    body = json.dumps({"kind": "cbb", "season": season, "week": 0, "generatedAt": payload["generatedAt"], "payload": payload}).encode()
    print(f"{len(team_rows)} teams, {len(game_rows)} upcoming games, {sum(g['pick'] is not None for g in game_rows)} picks, "
          f"{len(results)} recent finals; {len(body) / 1024:.0f} KB", flush=True)
    if out_path:
        json.dump(payload, open(out_path, "w"), indent=1)

    origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
    if not origin or not token:
        print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
        return
    request = urllib.request.Request(f"{origin.rstrip('/')}/api/reports/ingest", data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "probable-cbb-daily"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            print("Sent:", response.status, response.read().decode()[:200])
    except urllib.error.HTTPError as error:
        sys.exit(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
