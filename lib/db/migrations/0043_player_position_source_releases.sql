CREATE TABLE IF NOT EXISTS player_position_source_releases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season integer NOT NULL,
  captured_at timestamptz NOT NULL,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT player_position_source_release_fingerprint_unique UNIQUE (season, fingerprint)
);
CREATE INDEX IF NOT EXISTS player_position_source_release_time_idx
  ON player_position_source_releases (season, captured_at);