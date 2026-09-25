-- @execute-once
-- The development runner could baseline 0034 by trigger name even when the
-- existing function still had the old, immutability-only body. This applies
-- the stronger transition predicate once on those databases without changing
-- any prior migration checksums. New databases safely run it after 0034.
CREATE OR REPLACE FUNCTION reject_canonical_prediction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authoritative_kickoff timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.official_final_prediction THEN
      RAISE EXCEPTION 'official prediction snapshots are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.official_final_prediction AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'official prediction snapshots are immutable';
  END IF;
  IF NEW.official_final_prediction AND NOT OLD.official_final_prediction THEN
    SELECT kickoff_time INTO authoritative_kickoff FROM games
      WHERE game_id = NEW.game_id;
    IF authoritative_kickoff IS NULL
      OR NEW.kickoff_time IS DISTINCT FROM authoritative_kickoff
      OR NEW.frozen_at IS NULL OR NEW.frozen_at >= authoritative_kickoff
      OR clock_timestamp() >= authoritative_kickoff
      OR NEW.evaluation_cutoff_at IS NULL
      OR NEW.evaluation_cutoff_at > authoritative_kickoff - interval '30 minutes'
      OR NEW.prediction_timestamp > NEW.evaluation_cutoff_at THEN
      RAISE EXCEPTION 'official prediction requires a pre-kickoff freeze and a model snapshot at or before the 30-minute cutoff';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;