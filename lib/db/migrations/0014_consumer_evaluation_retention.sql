ALTER TABLE "model_evaluation_predictions"
  ADD COLUMN IF NOT EXISTS "evaluation_run_id" text,
  ADD COLUMN IF NOT EXISTS "home_team_id" text,
  ADD COLUMN IF NOT EXISTS "away_team_id" text,
  ADD COLUMN IF NOT EXISTS "projected_home_win_probability" double precision,
  ADD COLUMN IF NOT EXISTS "projected_away_win_probability" double precision,
  ADD COLUMN IF NOT EXISTS "projected_margin" double precision,
  ADD COLUMN IF NOT EXISTS "projected_total" double precision,
  ADD COLUMN IF NOT EXISTS "market_evidence" jsonb,
  ADD COLUMN IF NOT EXISTS "closing_market_evidence" jsonb;

CREATE INDEX IF NOT EXISTS "model_evaluation_prediction_run_game_idx"
  ON "model_evaluation_predictions" ("evaluation_run_id", "game_id");