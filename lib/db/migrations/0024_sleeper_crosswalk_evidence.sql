CREATE TABLE IF NOT EXISTS "sleeper_player_crosswalk_evidence" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "gridline_player_id" text NOT NULL,
  "source_namespace" text NOT NULL,
  "source_player_id" text NOT NULL,
  "target_namespace" text NOT NULL,
  "target_player_id" text NOT NULL,
  "evidence_method" text NOT NULL,
  "evidence_confidence" double precision NOT NULL,
  "first_observed_at" timestamptz NOT NULL,
  "last_verified_at" timestamptz NOT NULL,
  "evidence_fingerprint" text NOT NULL,
  "ambiguous" boolean NOT NULL DEFAULT false,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sleeper_player_crosswalk_evidence_fingerprint_unique"
    UNIQUE ("evidence_fingerprint")
);

CREATE INDEX IF NOT EXISTS "sleeper_player_crosswalk_source_idx"
  ON "sleeper_player_crosswalk_evidence" ("source_namespace", "source_player_id", "last_verified_at");
CREATE INDEX IF NOT EXISTS "sleeper_player_crosswalk_gridline_idx"
  ON "sleeper_player_crosswalk_evidence" ("gridline_player_id", "last_verified_at");

CREATE OR REPLACE FUNCTION "prevent_sleeper_crosswalk_evidence_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Sleeper crosswalk evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS "sleeper_player_crosswalk_evidence_append_only"
  ON "sleeper_player_crosswalk_evidence";
CREATE TRIGGER "sleeper_player_crosswalk_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "sleeper_player_crosswalk_evidence"
  FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_crosswalk_evidence_mutation"();