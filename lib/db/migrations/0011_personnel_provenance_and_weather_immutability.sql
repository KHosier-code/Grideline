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