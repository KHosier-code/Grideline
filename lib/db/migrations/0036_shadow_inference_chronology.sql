ALTER TABLE shadow_model_cutoffs
  DROP CONSTRAINT IF EXISTS shadow_model_cutoffs_chronology_check;

ALTER TABLE shadow_model_cutoffs
  ADD CONSTRAINT shadow_model_cutoffs_prediction_chronology_check
  CHECK (cutoff_at < kickoff_time AND prediction_at < kickoff_time);