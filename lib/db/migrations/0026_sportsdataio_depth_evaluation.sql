CREATE TABLE IF NOT EXISTS "sportsdataio_evaluation_runs" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "run_id" text NOT NULL UNIQUE,
  "status" text NOT NULL,
  "endpoint" text NOT NULL,
  "authentication_method" text NOT NULL,
  "account_access" text NOT NULL,
  "documented_call_interval" text,
  "production_use_verified" boolean NOT NULL DEFAULT false,
  "commercial_license_verified" boolean NOT NULL DEFAULT false,
  "limitation" text,
  "captured_at" timestamptz,
  "completed_at" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sportsdataio_evaluation_runs_created_idx"
  ON "sportsdataio_evaluation_runs" ("created_at");

CREATE TABLE IF NOT EXISTS "sportsdataio_depth_evidence" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "run_id" text NOT NULL,
  "provider_depth_chart_id" text NOT NULL,
  "provider_team_id" text NOT NULL,
  "provider_player_id" text,
  "player_name" text,
  "original_position" text,
  "original_role" text,
  "normalized_role" text,
  "unit" text NOT NULL,
  "depth_order" integer,
  "status_fields" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "provider_updated_at" timestamptz,
  "provider_version" text,
  "captured_at" timestamptz NOT NULL,
  "source_hash" text NOT NULL,
  CONSTRAINT "sportsdataio_depth_evidence_run_row_unique"
    UNIQUE ("run_id", "provider_depth_chart_id")
);
CREATE INDEX IF NOT EXISTS "sportsdataio_depth_evidence_run_team_idx"
  ON "sportsdataio_depth_evidence" ("run_id", "provider_team_id");

CREATE TABLE IF NOT EXISTS "sportsdataio_identity_mappings" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "run_id" text NOT NULL,
  "provider_depth_chart_id" text NOT NULL,
  "provider_player_id" text,
  "mapped_gridline_player_id" text,
  "mapping_status" text NOT NULL,
  "mapping_method" text NOT NULL,
  "mapping_confidence" double precision NOT NULL DEFAULT 0,
  "candidate_gridline_player_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "ambiguity_reason" text,
  "unmatched_reason" text,
  "collision" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sportsdataio_identity_mappings_run_row_unique"
    UNIQUE ("run_id", "provider_depth_chart_id")
);
CREATE INDEX IF NOT EXISTS "sportsdataio_identity_mappings_run_status_idx"
  ON "sportsdataio_identity_mappings" ("run_id", "mapping_status");