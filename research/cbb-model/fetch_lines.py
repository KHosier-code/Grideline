"""Betting lines for past college basketball games from ESPN game pages.

Usage: python fetch_lines.py SCHEDULE_PARQUET OUT_CSV

For every completed game in the schedule, reads the game summary's
"pickcenter" block (the sportsbook line ESPN shows on the game page) and
writes one row per game: provider, home spread, total, moneylines, and the
opening and closing numbers when ESPN has both. Games without a line are
written with blanks so a rerun can tell "no line" from "not fetched".
"""
import csv
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={}"
FIELDS = ["game_id", "provider", "details", "spread", "over_under", "home_ml", "away_ml",
          "home_spread_open", "home_spread_close", "total_open", "total_close"]


def get(game_id):
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(game_id), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except Exception:
            time.sleep(2 ** attempt)
    return None


def num(value):
    try:
        return float(str(value).replace("+", "")) if value not in (None, "", "OFF", "EVEN") else (100.0 if value == "EVEN" else None)
    except ValueError:
        return None


def line(game_id):
    data = get(game_id)
    row = {"game_id": game_id}
    picks = (data or {}).get("pickcenter") or []
    if not picks:
        return row
    p = picks[0]
    home, away = p.get("homeTeamOdds") or {}, p.get("awayTeamOdds") or {}
    spread = (p.get("pointSpread") or {}).get("home") or {}
    total = (p.get("total") or {}).get("over") or {}
    row.update({
        "provider": (p.get("provider") or {}).get("name"), "details": p.get("details"),
        "spread": num(p.get("spread")), "over_under": num(p.get("overUnder")),
        "home_ml": num(home.get("moneyLine")), "away_ml": num(away.get("moneyLine")),
        "home_spread_open": num((spread.get("open") or {}).get("line")),
        "home_spread_close": num((spread.get("close") or {}).get("line")),
        "total_open": num(str((total.get("open") or {}).get("line") or "").lstrip("ou")),
        "total_close": num(str((total.get("close") or {}).get("line") or "").lstrip("ou")),
    })
    return row


def main(schedule_path, out_path):
    sched = pd.read_parquet(schedule_path)
    done = sched[sched.status_type_completed.fillna(False).astype(bool)] if "status_type_completed" in sched else sched
    ids = sorted(done.game_id.astype(str).unique())
    print(f"{len(ids)} completed games", flush=True)
    with open(out_path, "w", newline="") as fh, ThreadPoolExecutor(8) as pool:
        writer = csv.DictWriter(fh, FIELDS)
        writer.writeheader()
        found = 0
        for i, row in enumerate(pool.map(line, ids)):
            writer.writerow(row)
            found += row.get("spread") is not None
            if i % 500 == 0:
                print(f"{i}/{len(ids)} fetched, {found} with a spread", flush=True)
    print(f"done: {found}/{len(ids)} games with a spread")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
