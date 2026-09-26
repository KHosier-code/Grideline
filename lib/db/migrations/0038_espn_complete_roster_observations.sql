CREATE TABLE IF NOT EXISTS espn_roster_observations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id integer NOT NULL,
  player_id text NOT NULL,
  team_id text NOT NULL,
  player_name text NOT NULL,
  position text,
  active_status text,
  source_path text NOT NULL,
  source_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  publication_at timestamptz,
  CONSTRAINT espn_roster_observations_run_player_unique UNIQUE (run_id, player_id)
);
CREATE INDEX IF NOT EXISTS espn_roster_observations_player_observed_idx
  ON espn_roster_observations (player_id, observed_at);