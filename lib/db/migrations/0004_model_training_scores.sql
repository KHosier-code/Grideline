ALTER TABLE "team_game_stats"
  ADD COLUMN IF NOT EXISTS "team_score" integer,
  ADD COLUMN IF NOT EXISTS "opponent_score" integer;