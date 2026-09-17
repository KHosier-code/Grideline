CREATE TABLE IF NOT EXISTS usage_analytics_retention (
  id integer PRIMARY KEY DEFAULT 1,
  last_attempt_at timestamptz,
  last_attempt_status text,
  last_successful_at timestamptz,
  last_successful_deleted_events integer,
  last_successful_batches integer,
  last_successful_cutoff timestamptz,
  latest_error text,
  latest_error_at timestamptz,
  CONSTRAINT usage_analytics_retention_singleton CHECK (id = 1)
);