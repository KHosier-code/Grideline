#!/usr/bin/env bash
# Downloads the public nflverse data the TD model uses into ./data (not committed).
set -euo pipefail
mkdir -p data && cd data
base=https://github.com/nflverse/nflverse-data/releases/download
season=${1:-2026}
for y in $(seq 2019 "$season"); do
  curl -fsSL -o "pbp_$y.parquet" "$base/pbp/play_by_play_$y.parquet"
  curl -fsSL -o "stats_$y.parquet" "$base/stats_player/stats_player_week_$y.parquet"
done
curl -fsSL -o "rosters_$season.parquet" "$base/weekly_rosters/roster_weekly_$season.parquet"
curl -fsSL -o "injuries_$season.parquet" "$base/injuries/injuries_$season.parquet"
curl -fsSL -o games.csv https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
