CREATE TABLE IF NOT EXISTS "prediction_validation_failures" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "game_id" text NOT NULL,
  "prediction_timestamp" timestamp with time zone NOT NULL,
  "snapshot_label" text NOT NULL,
  "feature_version" text NOT NULL,
  "spread_model_version" text,
  "moneyline_model_version" text,
  "totals_model_version" text,
  "failed_field" text NOT NULL,
  "invalid_value" text,
  "invalid_type" text,
  "failure_reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "prediction_validation_failures_game_idx"
  ON "prediction_validation_failures" ("game_id", "prediction_timestamp");