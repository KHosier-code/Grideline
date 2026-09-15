CREATE INDEX IF NOT EXISTS "model_evaluation_prediction_run_id_idx"
  ON "model_evaluation_predictions" ("evaluation_run_id", "id");

ALTER TABLE "model_evaluation_predictions"
  ADD CONSTRAINT "model_evaluation_future_identity_check"
  CHECK (
    "evaluation_run_id" IS NULL OR
    ("home_team_id" IS NOT NULL AND "away_team_id" IS NOT NULL AND "home_team_id" <> "away_team_id")
  ) NOT VALID,
  ADD CONSTRAINT "model_evaluation_outcome_consistency_check"
  CHECK (
    "actual_margin" = "actual_home_score" - "actual_away_score" AND
    "actual_total" = "actual_home_score" + "actual_away_score" AND
    "actual_home_win" = CASE WHEN "actual_home_score" > "actual_away_score" THEN 1 ELSE 0 END
  ) NOT VALID,
  ADD CONSTRAINT "model_evaluation_projection_completeness_check"
  CHECK (
    "evaluation_run_id" IS NULL OR
    ("family" = 'spread' AND "projected_margin" IS NOT NULL) OR
    ("family" = 'totals' AND "projected_total" IS NOT NULL) OR
    ("family" = 'moneyline' AND "projected_home_win_probability" IS NOT NULL AND "projected_away_win_probability" IS NOT NULL)
  ) NOT VALID;