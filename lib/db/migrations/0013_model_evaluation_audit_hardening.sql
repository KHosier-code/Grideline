ALTER TABLE "model_evaluation_predictions"
  ADD COLUMN IF NOT EXISTS "game_stage" text NOT NULL DEFAULT 'unknown';

ALTER TABLE "model_evaluation_predictions"
  ADD CONSTRAINT "model_evaluation_prediction_run_fk"
  FOREIGN KEY ("model_version") REFERENCES "model_training_runs" ("model_version");

ALTER TABLE "model_evaluation_predictions"
  ADD CONSTRAINT "model_evaluation_market_provenance_check"
  CHECK (
    ("market_observed_at" IS NULL AND "market_sportsbook" IS NULL AND "market_name" IS NULL AND "market_selection" IS NULL AND "market_price" IS NULL)
    OR
    ("market_observed_at" IS NOT NULL AND "market_sportsbook" IS NOT NULL AND "market_name" IS NOT NULL AND "market_selection" IS NOT NULL AND "market_price" IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS "sportsbook_odds_game_market_captured_idx"
  ON "sportsbook_odds" ("game_id", "market", "captured_at", "id");