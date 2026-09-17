CREATE TABLE IF NOT EXISTS "identity_source_imports" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "source_namespace" text NOT NULL,
  "source_url" text NOT NULL,
  "source_content_hash" text NOT NULL,
  "canonical_rows_hash" text NOT NULL,
  "source_headers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "row_count" integer NOT NULL,
  "imported_at" timestamptz NOT NULL DEFAULT now(),
  "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "identity_source_imports_content_unique" UNIQUE ("source_namespace", "source_content_hash")
);
CREATE INDEX IF NOT EXISTS "identity_source_imports_namespace_idx"
  ON "identity_source_imports" ("source_namespace", "imported_at");

CREATE TABLE IF NOT EXISTS "nflverse_player_identities" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "import_id" integer NOT NULL,
  "gsis_id" text NOT NULL,
  "display_name" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "position" text,
  "position_group" text,
  "team" text,
  "status" text,
  "espn_id" text, "pfr_id" text, "pff_id" text, "otc_id" text,
  "esb_id" text, "nfl_id" text, "smart_id" text,
  "source_row" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "row_fingerprint" text NOT NULL,
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nflverse_player_identities_import_gsis_unique" UNIQUE ("import_id", "gsis_id")
);
CREATE INDEX IF NOT EXISTS "nflverse_player_identities_gsis_idx" ON "nflverse_player_identities" ("gsis_id");
CREATE INDEX IF NOT EXISTS "nflverse_player_identities_provider_ids_idx"
  ON "nflverse_player_identities" ("espn_id", "pfr_id", "pff_id");

CREATE TABLE IF NOT EXISTS "player_identity_crosswalk_revisions" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "revision" integer NOT NULL,
  "gridline_player_id" text NOT NULL,
  "source_namespace" text NOT NULL,
  "source_player_id" text NOT NULL,
  "target_namespace" text NOT NULL,
  "target_player_id" text NOT NULL,
  "evidence_method" text NOT NULL,
  "evidence_confidence" text NOT NULL,
  "first_observed" timestamptz NOT NULL,
  "last_verified" timestamptz NOT NULL,
  "evidence_fingerprint" text NOT NULL,
  "ambiguity_flag" boolean NOT NULL DEFAULT false,
  "source_import_id" integer,
  "evidence_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "player_identity_crosswalk_revision_unique"
    UNIQUE ("source_namespace", "source_player_id", "target_namespace", "target_player_id", "evidence_fingerprint", "revision")
);
CREATE INDEX IF NOT EXISTS "player_identity_crosswalk_lookup_idx"
  ON "player_identity_crosswalk_revisions" ("source_namespace", "source_player_id", "ambiguity_flag");
CREATE INDEX IF NOT EXISTS "player_identity_crosswalk_gridline_idx"
  ON "player_identity_crosswalk_revisions" ("gridline_player_id", "target_namespace", "target_player_id");
CREATE INDEX IF NOT EXISTS "player_identity_crosswalk_stale_idx"
  ON "player_identity_crosswalk_revisions" ("last_verified");

CREATE OR REPLACE FUNCTION "prevent_player_identity_evidence_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Player identity evidence is append-only'; END;
$$;
DROP TRIGGER IF EXISTS "identity_source_imports_append_only" ON "identity_source_imports";
CREATE TRIGGER "identity_source_imports_append_only" BEFORE UPDATE OR DELETE ON "identity_source_imports"
FOR EACH ROW EXECUTE FUNCTION "prevent_player_identity_evidence_mutation"();
DROP TRIGGER IF EXISTS "nflverse_player_identities_append_only" ON "nflverse_player_identities";
CREATE TRIGGER "nflverse_player_identities_append_only" BEFORE UPDATE OR DELETE ON "nflverse_player_identities"
FOR EACH ROW EXECUTE FUNCTION "prevent_player_identity_evidence_mutation"();
DROP TRIGGER IF EXISTS "player_identity_crosswalk_append_only" ON "player_identity_crosswalk_revisions";
CREATE TRIGGER "player_identity_crosswalk_append_only" BEFORE UPDATE OR DELETE ON "player_identity_crosswalk_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_player_identity_evidence_mutation"();