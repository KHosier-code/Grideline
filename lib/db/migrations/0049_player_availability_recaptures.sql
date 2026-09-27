-- Re-fetching an unchanged publisher page is a new point-in-time observation.
ALTER TABLE player_availability_sources DROP CONSTRAINT IF EXISTS player_availability_source_observation_unique;

CREATE OR REPLACE FUNCTION reject_player_availability_source_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Archived player availability sources are append-only';
END;
$$;
CREATE TRIGGER player_availability_sources_append_only
BEFORE UPDATE OR DELETE ON player_availability_sources
FOR EACH ROW EXECUTE FUNCTION reject_player_availability_source_changes();