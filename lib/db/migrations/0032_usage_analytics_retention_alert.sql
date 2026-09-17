ALTER TABLE usage_analytics_retention
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_failure_at timestamptz;