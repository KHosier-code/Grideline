CREATE TABLE IF NOT EXISTS usage_analytics_events (
  id serial PRIMARY KEY,
  event_name text NOT NULL,
  filter text,
  value text,
  column_name text,
  direction text,
  action text,
  position text,
  trend text,
  coverage text,
  usage_window text,
  had_team boolean,
  had_position boolean,
  had_game boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_analytics_events_created_idx
  ON usage_analytics_events (created_at);

CREATE INDEX IF NOT EXISTS usage_analytics_events_name_created_idx
  ON usage_analytics_events (event_name, created_at);