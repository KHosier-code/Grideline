CREATE TABLE IF NOT EXISTS "model_evaluation_predictions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "model_version" text NOT NULL,
  "family" text NOT NULL,
  "algorithm" text NOT NULL,
  "feature_version" text NOT NULL,
  "test_season" integer NOT NULL,
  "week" integer NOT NULL,
  "evaluation_stage" text NOT NULL DEFAULT 'season_holdout',
  "game_id" text NOT NULL,
  "kickoff_time" timestamp with time zone NOT NULL,
  "prediction_cutoff" timestamp with time zone NOT NULL,
  "training_seasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "training_cutoff" text NOT NULL,
  "home_feature_source_cutoff" timestamp with time zone NOT NULL,
  "away_feature_source_cutoff" timestamp with time zone NOT NULL,
  "low_sample" boolean NOT NULL,
  "predicted_value" double precision NOT NULL,
  "actual_value" double precision NOT NULL,
  "actual_home_score" integer NOT NULL,
  "actual_away_score" integer NOT NULL,
  "actual_margin" double precision NOT NULL,
  "actual_total" double precision NOT NULL,
  "actual_home_win" double precision NOT NULL,
  "market_sportsbook" text,
  "market_name" text,
  "market_selection" text,
  "market_point" double precision,
  "market_price" integer,
  "market_observed_at" timestamp with time zone,
  "evaluated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "model_evaluation_prediction_version_game_unique" UNIQUE("model_version", "game_id"),
  CONSTRAINT "model_evaluation_prediction_cutoff_check" CHECK ("prediction_cutoff" <= "kickoff_time"),
  CONSTRAINT "model_evaluation_home_feature_chronology_check" CHECK ("home_feature_source_cutoff" < "prediction_cutoff"),
  CONSTRAINT "model_evaluation_away_feature_chronology_check" CHECK ("away_feature_source_cutoff" < "prediction_cutoff"),
  CONSTRAINT "model_evaluation_market_chronology_check" CHECK ("market_observed_at" IS NULL OR "market_observed_at" < "prediction_cutoff")
);

CREATE INDEX IF NOT EXISTS "model_evaluation_prediction_season_week_idx"
  ON "model_evaluation_predictions" ("test_season", "week", "family");
CREATE INDEX IF NOT EXISTS "model_evaluation_prediction_game_idx"
  ON "model_evaluation_predictions" ("game_id");

CREATE OR REPLACE FUNCTION reject_model_evaluation_prediction_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'model evaluation prediction evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_evaluation_predictions_immutable
  ON "model_evaluation_predictions";
CREATE TRIGGER model_evaluation_predictions_immutable
BEFORE UPDATE OR DELETE ON "model_evaluation_predictions"
FOR EACH ROW EXECUTE FUNCTION reject_model_evaluation_prediction_mutation();