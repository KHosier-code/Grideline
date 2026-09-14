CREATE TABLE IF NOT EXISTS "weather_forecast_snapshots" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "game_id" text NOT NULL,
  "source" text NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL,
  "forecast_generated_at" timestamp with time zone,
  "valid_time" timestamp with time zone NOT NULL,
  "temperature" double precision,
  "sustained_wind" double precision,
  "wind_gust" double precision,
  "precipitation_probability" double precision,
  "precipitation_type" text,
  "humidity" double precision,
  "weather_summary" text,
  "indoor_outdoor" text NOT NULL,
  "roof_status" text,
  "source_url" text,
  "office" text,
  "gridpoint" text
);
CREATE INDEX IF NOT EXISTS "weather_forecast_game_valid_idx"
  ON "weather_forecast_snapshots" ("game_id", "valid_time", "fetched_at");

ALTER TABLE "depth_chart_snapshots"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "classification" text NOT NULL DEFAULT 'published_secondary';

CREATE OR REPLACE FUNCTION "prevent_weather_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'weather forecast snapshots are append-only';
END;
$$;

DROP TRIGGER IF EXISTS "weather_forecast_snapshots_append_only"
  ON "weather_forecast_snapshots";
CREATE TRIGGER "weather_forecast_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "weather_forecast_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "prevent_weather_snapshot_mutation"();