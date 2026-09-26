CREATE INDEX IF NOT EXISTS games_usage_season_kickoff_idx
  ON games (season, kickoff_time);
CREATE INDEX IF NOT EXISTS player_game_stats_usage_matchup_idx
  ON player_game_stats (season, team_id, week, opponent_team_id);
CREATE INDEX IF NOT EXISTS snap_counts_usage_matchup_idx
  ON snap_counts (season, team_id, week, opponent_team_id);