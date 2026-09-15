ALTER TABLE "model_evaluation_predictions"
  ADD COLUMN IF NOT EXISTS "market_side" text;

ALTER TABLE "model_evaluation_predictions"
  ADD CONSTRAINT "model_evaluation_future_market_side_check"
  CHECK (
    "evaluation_run_id" IS NULL OR
    ("market_observed_at" IS NULL AND "market_side" IS NULL) OR
    ("market_observed_at" IS NOT NULL AND "market_side" IN ('home', 'away', 'over', 'under'))
  ) NOT VALID;