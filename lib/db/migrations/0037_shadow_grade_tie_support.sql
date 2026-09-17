ALTER TABLE shadow_model_grades
  ALTER COLUMN home_win DROP NOT NULL;

ALTER TABLE shadow_model_grades
  DROP CONSTRAINT IF EXISTS shadow_model_grades_score_check;

ALTER TABLE shadow_model_grades
  ADD CONSTRAINT shadow_model_grades_nullable_home_win_check
  CHECK (
    actual_margin = actual_home_score - actual_away_score
    AND actual_total = actual_home_score + actual_away_score
    AND (home_win IS NULL OR home_win IN (0, 1))
  );