CREATE TABLE IF NOT EXISTS player_position_source_versions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset text NOT NULL CHECK (dataset IN ('pbp', 'player_stats')),
  season integer NOT NULL,
  source_url text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size integer NOT NULL CHECK (size > 0),
  object_key text NOT NULL,
  generation text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  CONSTRAINT player_position_source_version_unique UNIQUE (dataset, season, sha256)
);

CREATE TRIGGER player_position_source_versions_append_only
BEFORE UPDATE OR DELETE ON player_position_source_versions
FOR EACH ROW EXECUTE FUNCTION reject_player_position_release_mutation();