ALTER TABLE "model_training_runs"
  ADD COLUMN "vector_feature_names" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "vector_schema_fingerprint" text,
  ADD COLUMN "model_artifact" jsonb;

ALTER TABLE "prediction_snapshots"
  ADD COLUMN "input_vector" jsonb,
  ADD COLUMN "vector_feature_names" jsonb,
  ADD COLUMN "vector_schema_fingerprint" text,
  ADD COLUMN "input_source_evidence" jsonb;
