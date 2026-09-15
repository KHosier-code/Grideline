ALTER TABLE "prediction_snapshots"
  ADD COLUMN "input_feature_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "input_missing_feature_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "prediction_snapshots"
  ADD CONSTRAINT "prediction_snapshots_input_counts_check"
  CHECK (
    "input_feature_count" >= 0
    AND "input_missing_feature_count" >= 0
    AND "input_missing_feature_count" <= "input_feature_count"
  );