CREATE TABLE IF NOT EXISTS "sleeper_player_snapshots" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "snapshot_id" text NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "source_timestamp" timestamptz,
  "source" text NOT NULL DEFAULT 'sleeper',
  "sleeper_player_id" text NOT NULL,
  "full_name" text,
  "first_name" text,
  "last_name" text,
  "team" text,
  "position" text,
  "fantasy_positions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "depth_chart_position" text,
  "depth_chart_order" integer,
  "status" text,
  "injury_status" text,
  "practice_participation" text,
  "years_exp" integer,
  "age" integer,
  "provider_ids" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_hash" text NOT NULL,
  "source_version" text,
  CONSTRAINT "sleeper_player_snapshot_cycle_player_unique"
    UNIQUE ("snapshot_id", "sleeper_player_id")
);

CREATE INDEX IF NOT EXISTS "sleeper_player_snapshots_captured_idx"
  ON "sleeper_player_snapshots" ("captured_at", "id");
CREATE INDEX IF NOT EXISTS "sleeper_player_snapshots_player_captured_idx"
  ON "sleeper_player_snapshots" ("sleeper_player_id", "captured_at");
CREATE INDEX IF NOT EXISTS "sleeper_player_snapshots_team_idx"
  ON "sleeper_player_snapshots" ("team", "captured_at");

CREATE OR REPLACE FUNCTION "prevent_sleeper_player_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Sleeper player snapshots are append-only';
END;
$$;

DROP TRIGGER IF EXISTS "sleeper_player_snapshots_append_only"
  ON "sleeper_player_snapshots";
CREATE TRIGGER "sleeper_player_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "sleeper_player_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_player_snapshot_mutation"();