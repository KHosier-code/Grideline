CREATE TABLE IF NOT EXISTS player_availability_sources (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('game-roster', 'injury-clearance')),
  publisher text NOT NULL,
  source_url text NOT NULL,
  source_hash text NOT NULL,
  source_body text NOT NULL,
  publication_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  game_id text NOT NULL,
  team text NOT NULL,
  player_id text NOT NULL,
  provider_id text NOT NULL,
  player_name text NOT NULL,
  assertion text NOT NULL,
  excerpt text NOT NULL,
  CONSTRAINT player_availability_source_observation_unique UNIQUE (kind, source_hash, game_id, player_id)
);
CREATE INDEX IF NOT EXISTS player_availability_source_lookup_idx
  ON player_availability_sources (game_id, player_id, kind, observed_at DESC);