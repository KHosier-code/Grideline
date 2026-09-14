ALTER TABLE "model_training_runs"
  ADD COLUMN IF NOT EXISTS "recency_weighting" text NOT NULL DEFAULT 'none';