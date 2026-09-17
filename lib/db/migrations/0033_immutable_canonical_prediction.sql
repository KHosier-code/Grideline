-- A game can have exactly one canonical official prediction.  The application
-- still uses INSERT/UPDATE idempotently, while this index is the database guard
-- against concurrent freeze workers selecting two rows.
CREATE UNIQUE INDEX IF NOT EXISTS prediction_snapshots_one_official_per_game
  ON prediction_snapshots (game_id)
  WHERE official_final_prediction = true;

ALTER TABLE prediction_snapshots
  ADD COLUMN IF NOT EXISTS evaluation_cutoff_at timestamptz;

ALTER TABLE prediction_grades
  ADD CONSTRAINT prediction_grades_prediction_fk
  FOREIGN KEY (prediction_id) REFERENCES prediction_snapshots(id);

ALTER TABLE prediction_grades
  ADD CONSTRAINT prediction_grades_scores_nonnegative_check
  CHECK (
    (actual_home_score IS NULL OR actual_home_score >= 0)
    AND (actual_away_score IS NULL OR actual_away_score >= 0)
  );

CREATE OR REPLACE FUNCTION reject_canonical_prediction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_prediction_immutable ON prediction_snapshots;
CREATE TRIGGER canonical_prediction_immutable
BEFORE UPDATE OR DELETE ON prediction_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_canonical_prediction_mutation();

CREATE OR REPLACE FUNCTION reject_prediction_grade_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'prediction grades are immutable';
END;
$$;

DROP TRIGGER IF EXISTS prediction_grade_immutable ON prediction_grades;
CREATE TRIGGER prediction_grade_immutable
BEFORE UPDATE OR DELETE ON prediction_grades
FOR EACH ROW EXECUTE FUNCTION reject_prediction_grade_mutation();