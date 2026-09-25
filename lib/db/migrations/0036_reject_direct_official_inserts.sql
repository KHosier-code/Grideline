-- @execute-once
-- A canonical row must first exist as a pending model snapshot. Reject a
-- direct official INSERT so it cannot bypass the validated freeze transition.
-- This installs both guards even when prior custom triggers did not transfer.
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

  IF TG_OP = 'INSERT' THEN
    IF NEW.official_final_prediction THEN
      RAISE EXCEPTION 'official prediction requires a validated pending-to-official freeze';
    END IF;
    RETURN NEW;
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

DROP TRIGGER IF EXISTS canonical_prediction_immutable ON prediction_snapshots;
CREATE TRIGGER canonical_prediction_immutable
BEFORE INSERT OR UPDATE OR DELETE ON prediction_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_canonical_prediction_mutation();

CREATE OR REPLACE FUNCTION reject_prediction_grade_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prediction grades are immutable';
END;
$$;

DROP TRIGGER IF EXISTS prediction_grade_immutable ON prediction_grades;
CREATE TRIGGER prediction_grade_immutable
BEFORE UPDATE OR DELETE ON prediction_grades
FOR EACH ROW EXECUTE FUNCTION reject_prediction_grade_mutation();