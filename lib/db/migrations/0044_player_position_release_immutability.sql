CREATE OR REPLACE FUNCTION reject_player_position_release_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'player-position source releases are append-only';
END;
$$;

CREATE TRIGGER player_position_source_releases_append_only
BEFORE UPDATE OR DELETE ON player_position_source_releases
FOR EACH ROW EXECUTE FUNCTION reject_player_position_release_mutation();