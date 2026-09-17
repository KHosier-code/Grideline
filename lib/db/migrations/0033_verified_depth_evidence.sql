CREATE TABLE IF NOT EXISTS "verified_depth_evidence" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "team_id" text NOT NULL,
  "player_id" text,
  "player_name" text,
  "position" text,
  "role" text,
  "depth_rank" integer,
  "evidence_state" text NOT NULL DEFAULT 'verified',
  "availability" text NOT NULL DEFAULT 'unknown',
  "injury_status" text,
  "confidence" integer,
  "source" text NOT NULL,
  "source_url" text,
  "observed_at" timestamptz NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "verification_method" text NOT NULL,
  "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_hash" text NOT NULL,
  "snapshot_timestamp" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "verified_depth_evidence_state_check"
    CHECK ("evidence_state" IN ('verified', 'unavailable', 'ambiguous')),
  CONSTRAINT "verified_depth_evidence_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100))
);
CREATE INDEX IF NOT EXISTS "verified_depth_evidence_team_observed_idx"
  ON "verified_depth_evidence" ("team_id", "observed_at", "id");
CREATE INDEX IF NOT EXISTS "verified_depth_evidence_player_idx"
  ON "verified_depth_evidence" ("player_id", "observed_at");

CREATE OR REPLACE FUNCTION "prevent_verified_depth_evidence_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verified depth evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS "verified_depth_evidence_append_only" ON "verified_depth_evidence";
CREATE TRIGGER "verified_depth_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "verified_depth_evidence"
  FOR EACH ROW EXECUTE FUNCTION "prevent_verified_depth_evidence_mutation"();