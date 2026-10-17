#!/usr/bin/env bash
# Downloads the public nflverse data the TD model uses into ./data (not committed).
set -euo pipefail
mkdir -p data && cd data
base=https://github.com/nflverse/nflverse-data/releases/download
month=$((10#$(date -u +%m))); year=$(date -u +%Y)
default_season=$(( month >= 3 ? year : year - 1 ))
season=${1:-$default_season}
for y in $(seq 2019 "$season"); do
  curl -fsSL -o "pbp_$y.parquet" "$base/pbp/play_by_play_$y.parquet"
  curl -fsSL -o "stats_$y.parquet" "$base/stats_player/stats_player_week_$y.parquet"
done
curl -fsSL -o "rosters_$season.parquet" "$base/weekly_rosters/roster_weekly_$season.parquet"
curl -fsSL -o "injuries_$season.parquet" "$base/injuries/injuries_$season.parquet"
# Matchup report extras. They often post a week behind play-by-play, and a
# missing one only blanks its metrics, so a failed download never stops the run.
for file in "ftn_charting/ftn_charting_$season" "pfr_advstats/advstats_week_def_$season" \
            "pfr_advstats/advstats_week_pass_$season" "nextgen_stats/ngs_passing"; do
  curl -fsSL -o "$(basename "$file").parquet" "$base/$file.parquet" || echo "Skipped $file"
done
curl -fsSL -o games.csv https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
