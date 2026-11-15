"""Download past ESPN Bowl Mania seasons in the compact form bowl_backtest.py reads.

For each bowl: both teams, their moneylines as ESPN showed them, the share of
Bowl Mania players who picked each team (by scoring format), and the winner.
ESPN's data is not committed to this repository; run this to get it.

usage: python fetch_bowlmania.py out.json [2022 2023 2024 2025]
"""
import json
import sys
import urllib.request

URL = "https://gambit-api.fantasy.espn.com/apis/v1/challenges/college-football-bowl-mania-{year}?platform=chui&view=chui_default"


def mapping(mappings, kind):
    return next((m["value"] for m in mappings or [] if m.get("type") == kind), None)


def season(year):
    with urllib.request.urlopen(URL.format(year=year), timeout=60) as response:
        challenge = json.load(response)
    for prop in challenge.get("propositions", []):
        yield {
            "s": str(year), "n": prop.get("name"), "d": prop.get("date"), "st": prop.get("status"),
            "c": prop.get("correctOutcomes"),
            "o": [{
                "id": outcome.get("id"), "a": outcome.get("abbrev"), "t": outcome.get("name"),
                "p": {str(c["scoringFormatId"]): round(c["percentage"], 3) for c in outcome.get("choiceCounters", [])},
                "line": mapping(outcome.get("mappings"), "BETTING_LINE"),
                "comp": mapping(outcome.get("mappings"), "COMPETITOR_ID"),
                "ev": mapping(outcome.get("mappings"), "EVENT_ID"),
            } for outcome in prop.get("possibleOutcomes", [])],
        }


if __name__ == "__main__":
    years = sys.argv[2:] or ["2022", "2023", "2024", "2025"]
    games = [game for year in years for game in season(year)]
    json.dump(games, open(sys.argv[1], "w"))
    print(f"{len(games)} games from {', '.join(years)}")
