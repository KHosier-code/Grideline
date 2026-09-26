#!/usr/bin/env python3
"""Independent, read-only reconciliation of credited 2026 Week 2 PBP opportunities.

Usage:
  python3 scripts/validate-red-zone-week2.py \
    artifacts/api-server/.cache/nflverse/play_by_play_2026.csv.gz \
    2026_02_SEA_ARI 2026_02_DET_BUF

Output is source-game keyed. Compare team_zone and player_zone to the stored
facts on source_game_id, team_id, player_id, and zone; if stats/snaps supply
additional verified appearances, their zero rows may exist only in the database.
"""

import csv
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

ZONES = (5, 10, 20)


def flag(row, key):
    return row.get(key) == "1"


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: validate-red-zone-week2.py <2026-pbp.csv.gz> [source-game-id ...]")
    path = Path(sys.argv[1])
    selected = set(sys.argv[2:])
    teams = defaultdict(lambda: [0, 0])
    players = defaultdict(lambda: [0, 0, 0, 0])
    examples = {}
    seen = set()
    week2_rows = 0
    week2_games = set()
    duplicates = 0
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {
            "game_id", "play_id", "season", "week", "season_type",
            "posteam", "defteam", "home_team", "away_team", "yardline_100",
            "pass_attempt", "rush_attempt", "receiver_player_id", "rusher_player_id",
        }
        missing = required.difference(reader.fieldnames or ())
        if missing:
            raise ValueError(f"Missing required PBP columns: {sorted(missing)}")
        for row in reader:
            if row["season"] != "2026" or row["week"] != "2" or row["season_type"] != "REG":
                continue
            week2_rows += 1
            game = row["game_id"]
            week2_games.add(game)
            if selected and game not in selected:
                continue
            if not game or not row["play_id"]:
                continue
            offense, defense = row["posteam"], row["defteam"]
            if not offense or not defense or offense not in (row["home_team"], row["away_team"]):
                continue
            if defense not in (row["home_team"], row["away_team"]):
                continue
            offense = {"WAS": "WSH", "LA": "LAR"}.get(offense, offense)
            identity = (game, row["play_id"])
            if identity in seen:
                duplicates += 1
                continue
            seen.add(identity)
            if (flag(row, "no_play") or row.get("play_type", "").lower() == "no_play"
                or flag(row, "play_deleted") or flag(row, "nullified_play")
                or flag(row, "two_point_attempt") or flag(row, "qb_kneel") or flag(row, "qb_spike")):
                continue
            try:
                yardline = float(row["yardline_100"])
            except (ValueError, TypeError):
                continue
            # A valid credited play anywhere on the field is appearance
            # evidence; a valid team play anywhere is denominator evidence.
            # Neither becomes an opportunity until it is inside the zone.
            for zone in ZONES:
                teams[(game, offense, zone)]
            attempts = (
                ("target", row["receiver_player_id"], flag(row, "pass_touchdown"))
                if flag(row, "pass_attempt") and row["receiver_player_id"] else None,
                ("carry", row["rusher_player_id"], flag(row, "rush_touchdown"))
                if flag(row, "rush_attempt") and row["rusher_player_id"] else None,
            )
            for attempt in attempts:
                if attempt is None:
                    continue
                kind, player, touchdown = attempt
                for zone in ZONES:
                    player_counts = players[(game, offense, player, zone)]
                    if yardline > zone:
                        continue
                    team_counts = teams[(game, offense, zone)]
                    column = 0 if kind == "target" else 1
                    team_counts[column] += 1
                    player_counts[column] += 1
                    if touchdown:
                        player_counts[2 if kind == "target" else 3] += 1
                if yardline > 20:
                    continue
                label = ("receiving_td" if kind == "target" else "rushing_td") if touchdown else (
                    "incomplete_target" if kind == "target" and not flag(row, "complete_pass") else kind
                )
                examples.setdefault(label, {
                    "source_game_id": game, "play_id": row["play_id"], "team_id": offense,
                    "player_id": player, "yardline_100": yardline,
                })
    result = {
        "source_file": str(path),
        "week2_source_rows": week2_rows,
        "week2_source_game_count": len(week2_games),
        "selected_source_games": sorted(selected) if selected else sorted(week2_games),
        "duplicate_play_ids_in_selection": duplicates,
        "team_zone": [
            dict(zip(("source_game_id", "team_id", "zone", "targets", "carries"), (*key, *counts)))
            for key, counts in sorted(teams.items())
        ],
        "player_zone": [
            dict(zip(("source_game_id", "team_id", "player_id", "zone", "targets", "carries",
                      "receiving_touchdowns", "rushing_touchdowns"), (*key, *counts)))
            for key, counts in sorted(players.items())
        ],
        "examples": examples,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()