CREATE TABLE IF NOT EXISTS "sleeper_identity_mapping_runs" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "mapping_run_id" text NOT NULL,
  "source_snapshot_id" text NOT NULL,
  "source_captured_at" timestamptz,
  "mapping_version" text NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "records_processed" integer NOT NULL DEFAULT 0,
  "total_sleeper_rows" integer NOT NULL DEFAULT 0,
  "mapped_count" integer NOT NULL DEFAULT 0,
  "ambiguous_count" integer NOT NULL DEFAULT 0,
  "unmatched_count" integer NOT NULL DEFAULT 0,
  "collision_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_message" text,
  CONSTRAINT "sleeper_identity_mapping_runs_run_id_unique" UNIQUE ("mapping_run_id")
);

CREATE INDEX IF NOT EXISTS "sleeper_identity_mapping_runs_source_idx"
  ON "sleeper_identity_mapping_runs" ("source_snapshot_id", "started_at");
CREATE INDEX IF NOT EXISTS "sleeper_identity_mapping_runs_status_idx"
  ON "sleeper_identity_mapping_runs" ("status", "started_at");

CREATE TABLE IF NOT EXISTS "sleeper_identity_mappings" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "mapping_run_id" text NOT NULL,
  "source_snapshot_id" text NOT NULL,
  "sleeper_player_id" text NOT NULL,
  "source_hash" text NOT NULL,
  "mapped_gridline_player_id" text,
  "mapping_status" text NOT NULL,
  "mapping_method" text NOT NULL,
  "mapping_confidence" double precision NOT NULL,
  "original_team" text,
  "normalized_team" text,
  "team_normalization_method" text,
  "original_position" text,
  "normalized_position" text,
  "position_compatibility" text NOT NULL,
  "evidence_summary" text,
  "candidate_gridline_player_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "candidate_evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "ambiguity_reason" text,
  "unmatched_reason" text,
  "team_change_evidence" jsonb,
  "depth_relevant" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sleeper_identity_mappings_run_player_unique"
    UNIQUE ("mapping_run_id", "sleeper_player_id")
);

CREATE INDEX IF NOT EXISTS "sleeper_identity_mappings_status_idx"
  ON "sleeper_identity_mappings" ("mapping_run_id", "mapping_status");
CREATE INDEX IF NOT EXISTS "sleeper_identity_mappings_gridline_idx"
  ON "sleeper_identity_mappings" ("mapped_gridline_player_id", "mapping_run_id");
CREATE INDEX IF NOT EXISTS "sleeper_identity_mappings_depth_idx"
  ON "sleeper_identity_mappings" ("mapping_run_id", "depth_relevant");

CREATE OR REPLACE FUNCTION "prevent_sleeper_identity_mapping_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Sleeper identity mappings are append-only';
END;
$$;

DROP TRIGGER IF EXISTS "sleeper_identity_mapping_runs_append_only"
  ON "sleeper_identity_mapping_runs";
CREATE TRIGGER "sleeper_identity_mapping_runs_append_only"
  BEFORE UPDATE OR DELETE ON "sleeper_identity_mapping_runs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_identity_mapping_mutation"();

DROP TRIGGER IF EXISTS "sleeper_identity_mappings_append_only"
  ON "sleeper_identity_mappings";
CREATE TRIGGER "sleeper_identity_mappings_append_only"
  BEFORE UPDATE OR DELETE ON "sleeper_identity_mappings"
  FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_identity_mapping_mutation"();