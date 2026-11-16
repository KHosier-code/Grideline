"""Daily bowl pool job: fetch this season's bowls, betting lines and ESPN
Bowl Mania pick shares, build a sheet for every pool size x scoring x pool
type, and upload them to the site (weekly_reports, kind "bowls").

Sources:
- ESPN Bowl Mania (the matchups, each team's moneyline as ESPN shows it,
  and the share of Bowl Mania players picking each team, per scoring format)
- ESPN's college football scoreboard (fresher moneylines or spreads for
  upcoming games)

Without real pick shares for a scoring format, that format's sheets are plain
chalk: an estimate of the crowd from the odds made sheets worse in testing
(crowd_model.py).

usage:
  python bowls_daily.py --season 2026 [--out payload.json] [--upload]
  python bowls_daily.py --season 2025 --games-file bowlmania.json   # offline, compact format
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bowl_engine as engine  # noqa: E402

BOWL_MANIA = "https://gambit-api.fantasy.espn.com/apis/v1/challenges/college-football-bowl-mania-{season}?platform=chui&view=chui_default"
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?seasontype=3&week=1&groups=80&limit=100&dates={season}"
POOL_SIZES = (10, 25, 50, 100, 250)
SCORINGS = ("confidence", "straight")
# Bowl Mania scoring formats: 1 straight-up (default), 2 confidence, 3 against the spread.
FORMAT = {"straight": "1", "confidence": "2"}


def fetch_json(url, tries=3):
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; probable-bowls/1.0)"})
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries - 1:
                raise
        time.sleep(2 * (attempt + 1))
    return None


def mapping(mappings, kind):
    return next((m.get("value") for m in mappings or [] if m.get("type") == kind), None)


def as_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def games_from_bowlmania(challenge):
    """Each bowl with both teams, ESPN's moneylines, the crowd's shares and the winner once known."""
    games = []
    for prop in challenge.get("propositions", []):
        outcomes = prop.get("possibleOutcomes") or []
        if len(outcomes) != 2:
            continue
        teams = []
        for outcome in outcomes:
            maps = outcome.get("mappings")
            teams.append({
                "id": mapping(maps, "COMPETITOR_ID"), "outcome": outcome.get("id"),
                "abbr": outcome.get("abbrev"), "name": outcome.get("name"),
                "logo": mapping(maps, "IMAGE_PRIMARY"), "color": mapping(maps, "COLOR_PRIMARY"),
                "rank": as_number(mapping(maps, "RANKING")), "record": outcome.get("additionalInfo") or None,
                "home": outcome.get("subType") == "HOME",
                "moneyline": as_number(mapping(maps, "BETTING_LINE")),
                "crowd": {str(c["scoringFormatId"]): c.get("percentage") for c in outcome.get("choiceCounters", [])},
                "entries": {str(c["scoringFormatId"]): c.get("count") for c in outcome.get("choiceCounters", [])},
            })
        if any(not t["name"] or (t["abbr"] or "").upper() == "TBD" for t in teams):
            continue
        winner = (prop.get("correctOutcomes") or [None])[0]
        games.append({
            "id": mapping(outcomes[0].get("mappings"), "EVENT_ID") or prop.get("id"),
            "bowl": (prop.get("description") or prop.get("name") or "").split(":")[0].strip(),
            "kickoff": datetime.fromtimestamp(prop["date"] / 1000, timezone.utc).isoformat() if prop.get("date") else None,
            "status": (prop.get("status") or "").lower(),
            "teams": teams,
            "winner": 0 if winner and winner == teams[0]["outcome"] else 1 if winner and winner == teams[1]["outcome"] else None,
        })
    return games


def games_from_compact(rows, season):
    """The compact rows fetch_bowlmania.py writes, for offline runs."""
    games = []
    for row in rows:
        if str(row.get("s")) != str(season) or len(row.get("o", [])) != 2:
            continue
        teams = [{
            "id": o.get("comp"), "outcome": o.get("id"), "abbr": o.get("a"), "name": o.get("t"), "logo": None,
            "color": None, "rank": None, "record": None, "home": i == 1, "moneyline": as_number(o.get("line")),
            "crowd": o.get("p", {}), "entries": {},
        } for i, o in enumerate(row["o"])]
        winner = (row.get("c") or [None])[0]
        games.append({
            "id": row["o"][0].get("ev") or row.get("n"), "bowl": row.get("n"),
            "kickoff": datetime.fromtimestamp(row["d"] / 1000, timezone.utc).isoformat() if row.get("d") else None,
            "status": (row.get("st") or "").lower(), "teams": teams,
            "winner": 0 if winner == teams[0]["outcome"] else 1 if winner == teams[1]["outcome"] else None,
        })
    return games


def scoreboard_lines(board):
    """Fresher lines for upcoming games from ESPN's scoreboard: {event id: {competitor id: moneyline or spread}}."""
    lines = {}
    for event in (board or {}).get("events", []):
        comp = (event.get("competitions") or [{}])[0]
        odds = (comp.get("odds") or [None])[0]
        if not odds:
            continue
        sides = {c.get("homeAway"): c.get("team", {}).get("id") for c in comp.get("competitors", [])}
        home_ml = as_number(((odds.get("moneyline") or {}).get("home") or {}).get("close", {}).get("odds")) \
            or as_number((odds.get("homeTeamOdds") or {}).get("moneyLine"))
        away_ml = as_number(((odds.get("moneyline") or {}).get("away") or {}).get("close", {}).get("odds")) \
            or as_number((odds.get("awayTeamOdds") or {}).get("moneyLine"))
        spread = as_number(odds.get("spread"))  # from the home team's side
        lines[str(event.get("id"))] = {"home": sides.get("home"), "away": sides.get("away"),
                                       "home_ml": home_ml, "away_ml": away_ml, "home_spread": spread,
                                       "provider": (odds.get("provider") or {}).get("name")}
    return lines


def attach_win_chances(games, fresh):
    """Team A's chance from the freshest line: scoreboard moneylines, else Bowl Mania's, else a spread."""
    for game in games:
        a, b = game["teams"]
        line = fresh.get(str(game["id"]))
        upcoming = game["status"] in ("", "open", "pre", "scheduled")
        chance, source = None, None
        if line and upcoming and line["home_ml"] and line["away_ml"]:
            a_home = str(a["id"]) == str(line["home"])
            ml_a, ml_b = (line["home_ml"], line["away_ml"]) if a_home else (line["away_ml"], line["home_ml"])
            chance, source = engine.win_chance(ml_a, ml_b), line.get("provider") or "ESPN"
            a["moneyline"], b["moneyline"] = ml_a, ml_b
        elif a["moneyline"] and b["moneyline"]:
            chance, source = engine.win_chance(a["moneyline"], b["moneyline"]), "ESPN Bowl Mania"
        elif line and line["home_spread"] is not None:
            a_home = str(a["id"]) == str(line["home"])
            chance = engine.spread_win_chance(line["home_spread"] if a_home else -line["home_spread"])
            source = "ESPN spread"
        game["winA"], game["lineSource"] = chance, source
    return [g for g in games if g["winA"] is not None]


def build_payload(games, season, sims, check_sims, seed=7):
    rng = np.random.default_rng(seed)
    games = sorted(games, key=lambda g: (g["kickoff"] or "", g["bowl"]))
    p = np.array([g["winA"] for g in games])
    crowd, sheets = {}, {}
    for scoring in SCORINGS:
        key = FORMAT[scoring]
        shares = [g["teams"][0]["crowd"].get(key) for g in games]
        have = all(isinstance(s, (int, float)) for s in shares) and len(games) > 0
        entries = max((sum(t["entries"].get(key) or 0 for t in g["teams"]) for g in games), default=0)
        crowd[scoring] = {"available": have, "entries": int(entries) or None}
        q = np.clip(np.array(shares, dtype=float), 0.01, 0.99) if have else None
        confidence = scoring == "confidence"
        for pool_type in engine.POOL_TYPES:
            for pool in POOL_SIZES:
                started = time.time()
                if have:
                    sheet = engine.build_sheet(p, q, pool, confidence, rng, pool_type=pool_type,
                                               sims=sims, check_sims=check_sims)
                else:
                    picks, points = engine.chalk(p, confidence)
                    sheet = {"picks": picks, "points": points, "win": None, "chalk_win": None, "fair": 1 / (pool + 1)}
                sheets[f"{scoring}-{pool}-{pool_type}"] = {
                    "picks": [0 if a else 1 for a in sheet["picks"].tolist()],
                    "points": [int(x) for x in sheet["points"].tolist()],
                    "win": None if sheet["win"] is None else round(sheet["win"], 4),
                    "chalkWin": None if sheet["chalk_win"] is None else round(sheet["chalk_win"], 4),
                    "fair": round(sheet["fair"], 4), "tuned": have,
                }
                done = sheets[f"{scoring}-{pool}-{pool_type}"]
                print(f"{scoring:10} {pool_type:6} {pool:3d}: win {done['win']} chalk {done['chalkWin']} "
                      f"({time.time() - started:.1f}s)", flush=True)
    return {
        "season": season,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "firstKickoff": min((g["kickoff"] for g in games if g["kickoff"]), default=None),
        "poolSizes": list(POOL_SIZES), "poolTypes": list(engine.POOL_TYPES), "scorings": list(SCORINGS),
        "crowd": crowd,
        "games": [{
            "id": str(g["id"]), "bowl": g["bowl"], "kickoff": g["kickoff"], "status": g["status"],
            "winA": round(g["winA"], 4), "lineSource": g["lineSource"], "winner": g["winner"],
            "teams": [{k: t[k] for k in ("id", "abbr", "name", "logo", "color", "rank", "record", "home", "moneyline")}
                      | {"crowdStraight": t["crowd"].get(FORMAT["straight"]), "crowdConfidence": t["crowd"].get(FORMAT["confidence"])}
                      for t in g["teams"]],
        } for g in games],
        "sheets": sheets,
    }


def upload(payload):
    base = os.environ["GRIDLINE_INGEST_URL"].rstrip("/")
    body = json.dumps({"kind": "bowls", "season": payload["season"], "week": 0,
                       "generatedAt": payload["generatedAt"], "payload": payload}).encode()
    request = urllib.request.Request(f"{base}/api/reports/ingest", data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {os.environ['GRIDLINE_INGEST_TOKEN']}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        print("uploaded:", response.status, response.read()[:200].decode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="the year the bowls start, e.g. 2026")
    parser.add_argument("--games-file", help="offline: compact rows from fetch_bowlmania.py instead of fetching")
    parser.add_argument("--sims", type=int, default=1500)
    parser.add_argument("--check-sims", type=int, default=4000)
    parser.add_argument("--out")
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    if args.games_file:
        games = games_from_compact(json.load(open(args.games_file)), args.season)
        fresh = {}
    else:
        challenge = fetch_json(BOWL_MANIA.format(season=args.season))
        board = fetch_json(SCOREBOARD.format(season=args.season))
        games = games_from_bowlmania(challenge) if challenge else []
        print(f"Bowl Mania: {'found' if challenge else 'not found'}; {len(games)} bowls with both teams set")
        fresh = scoreboard_lines(board)
        print(f"Scoreboard: {len((board or {}).get('events', []))} events, {len(fresh)} with odds")
    games = attach_win_chances(games, fresh)
    if not games:
        print("No bowls with both teams and a line yet; nothing to publish.")
        return
    payload = build_payload(games, args.season, args.sims, args.check_sims)
    crowd = ", ".join(f"{scoring} {info['available']}" for scoring, info in payload["crowd"].items())
    print(f"{len(payload['games'])} bowls, {len(payload['sheets'])} sheets, crowd data: {crowd}")
    if args.out:
        json.dump(payload, open(args.out, "w"))
    if args.upload:
        upload(payload)


if __name__ == "__main__":
    main()
