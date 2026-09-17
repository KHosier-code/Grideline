CREATE TABLE IF NOT EXISTS "market_baseline_runs" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "run_id" text NOT NULL,
  "season" integer NOT NULL,
  "source" text NOT NULL,
  "source_url" text NOT NULL,
  "source_files" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source_fingerprints" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "market_baseline_runs_run_id_unique" UNIQUE ("run_id"),
  CONSTRAINT "market_baseline_runs_2025_only" CHECK ("season" = 2025)
);

CREATE INDEX IF NOT EXISTS "market_baseline_runs_season_idx"
  ON "market_baseline_runs" ("season", "created_at");

CREATE TABLE IF NOT EXISTS "market_baseline_events" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "run_id" text NOT NULL,
  "source_game_id" text NOT NULL,
  "alt_game_id" text NOT NULL,
  "outcome" text NOT NULL,
  "reason" text NOT NULL,
  "candidate_game_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "matched_game_id" text,
  "alias_used" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "market_baseline_events_run_source_unique" UNIQUE ("run_id", "source_game_id")
);

CREATE INDEX IF NOT EXISTS "market_baseline_events_run_outcome_idx"
  ON "market_baseline_events" ("run_id", "outcome");

CREATE TABLE IF NOT EXISTS "market_baseline_quotes" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "run_id" text NOT NULL,
  "source_game_id" text NOT NULL,
  "alt_game_id" text NOT NULL,
  "matched_game_id" text,
  "source_file" text NOT NULL,
  "family" text NOT NULL,
  "side" text NOT NULL,
  "point" double precision,
  "price" integer,
  "source_designation" text NOT NULL,
  "sportsbook" text,
  "observed_at" timestamp with time zone,
  "source_timestamp" timestamp with time zone,
  "source_outcome" double precision,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "market_baseline_recorded_only" CHECK ("source_designation" = 'source_designated_recorded'),
  CONSTRAINT "market_baseline_no_inferred_time" CHECK ("observed_at" IS NULL AND "source_timestamp" IS NULL)
);

ALTER TABLE "market_baseline_quotes"
  DROP CONSTRAINT IF EXISTS "market_baseline_quotes_source_designation_check";
ALTER TABLE "market_baseline_quotes"
  ADD CONSTRAINT "market_baseline_quotes_source_designation_check"
  CHECK ("source_designation" = 'source_designated_recorded');

CREATE INDEX IF NOT EXISTS "market_baseline_quotes_run_game_idx"
  ON "market_baseline_quotes" ("run_id", "matched_game_id", "family");

CREATE OR REPLACE FUNCTION reject_market_baseline_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'market baseline evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_baseline_runs_immutable ON "market_baseline_runs";
CREATE TRIGGER market_baseline_runs_immutable
BEFORE UPDATE OR DELETE ON "market_baseline_runs"
FOR EACH ROW EXECUTE FUNCTION reject_market_baseline_mutation();

DROP TRIGGER IF EXISTS market_baseline_events_immutable ON "market_baseline_events";
CREATE TRIGGER market_baseline_events_immutable
BEFORE UPDATE OR DELETE ON "market_baseline_events"
FOR EACH ROW EXECUTE FUNCTION reject_market_baseline_mutation();

DROP TRIGGER IF EXISTS market_baseline_quotes_immutable ON "market_baseline_quotes";
CREATE TRIGGER market_baseline_quotes_immutable
BEFORE UPDATE OR DELETE ON "market_baseline_quotes"
FOR EACH ROW EXECUTE FUNCTION reject_market_baseline_mutation();