#!/usr/bin/env bash
# Past college basketball seasons from sportsdataverse (free ESPN data).
# Seasons are named by the year they end; the season in progress comes from
# ESPN directly (daily.py), so this stops at last season.
set -euo pipefail
mkdir -p data
REL=https://github.com/sportsdataverse/sportsdataverse-data/releases/download
now=$(date -u +%Y); month=$(date -u +%-m)
last=$(( month >= 7 ? now : now - 1 ))
for y in $(seq 2019 "$last"); do
  curl -sSfL -o "data/team_box_$y.parquet" "$REL/espn_mens_college_basketball_team_boxscores/team_box_$y.parquet"
  curl -sSfL -o "data/mbb_schedule_$y.parquet" "$REL/espn_mens_college_basketball_schedules/mbb_schedule_$y.parquet"
  curl -sSfL -o "data/player_box_$y.parquet" "$REL/espn_mens_college_basketball_player_boxscores/player_box_$y.parquet"
done
ls -la data
