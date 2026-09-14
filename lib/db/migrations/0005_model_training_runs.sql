CREATE TABLE IF NOT EXISTS "model_training_runs" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "model_version" text NOT NULL,
  "family" text NOT NULL,
  "algorithm" text NOT NULL,
  "feature_version" text NOT NULL,
  "training_seasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "test_season" integer NOT NULL,
  "sample_policy" text NOT NULL,
  "status" text NOT NULL DEFAULT 'challenger',
  "sample_size" integer NOT NULL DEFAULT 0,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "calibration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "feature_importance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "trained_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "model_training_runs_version_unique" UNIQUE ("model_version")
);
CREATE INDEX IF NOT EXISTS "model_training_runs_family_idx"
  ON "model_training_runs" ("family", "test_season", "trained_at");