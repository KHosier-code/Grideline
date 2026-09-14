CREATE TABLE IF NOT EXISTS "model_promotion_history" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "family" text NOT NULL,
  "model_version" text NOT NULL,
  "algorithm" text NOT NULL,
  "feature_version" text NOT NULL,
  "training_cutoff" text NOT NULL,
  "role" text NOT NULL DEFAULT 'production',
  "promoted_at" timestamptz NOT NULL DEFAULT now(),
  "promoted_by" text NOT NULL,
  "reason" text
);
CREATE INDEX IF NOT EXISTS "model_promotion_history_family_idx"
  ON "model_promotion_history" ("family", "role", "promoted_at");

CREATE TABLE IF NOT EXISTS "prediction_snapshots" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "snapshot_key" text NOT NULL UNIQUE,
  "game_id" text NOT NULL,
  "prediction_timestamp" timestamptz NOT NULL DEFAULT now(),
  "snapshot_label" text NOT NULL,
  "kickoff_time" timestamptz,
  "feature_version" text NOT NULL,
  "spread_model_version" text,
  "moneyline_model_version" text,
  "totals_model_version" text,
  "training_cutoff" text NOT NULL,
  "projected_home_score" double precision,
  "projected_away_score" double precision,
  "projected_margin" double precision,
  "projected_total" double precision,
  "home_win_probability" double precision,
  "away_win_probability" double precision,
  "market_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "market_comparison" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "low_sample" boolean NOT NULL DEFAULT false,
  "qb_confidence" double precision,
  "official_final_prediction" boolean NOT NULL DEFAULT false,
  "frozen_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "prediction_snapshots_game_idx"
  ON "prediction_snapshots" ("game_id", "prediction_timestamp");
CREATE INDEX IF NOT EXISTS "prediction_snapshots_official_idx"
  ON "prediction_snapshots" ("official_final_prediction", "kickoff_time");

CREATE TABLE IF NOT EXISTS "prediction_grades" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "prediction_id" integer NOT NULL UNIQUE,
  "graded_at" timestamptz NOT NULL DEFAULT now(),
  "actual_home_score" integer,
  "actual_away_score" integer,
  "actual_margin" double precision,
  "actual_total" double precision,
  "margin_error" double precision,
  "total_error" double precision,
  "home_win_correct" boolean,
  "moneyline_brier" double precision,
  "moneyline_log_loss" double precision,
  "market_results" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "closing_markets" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "clv" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "why_miss" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "prediction_grades_graded_at_idx"
  ON "prediction_grades" ("graded_at");