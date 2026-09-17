CREATE TABLE IF NOT EXISTS shadow_model_cutoffs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id text NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  model_family text NOT NULL,
  model_version text NOT NULL,
  model_artifact_id text,
  model_artifact_checksum text,
  feature_version text NOT NULL,
  kickoff_time timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  prediction_at timestamptz NOT NULL,
  status text NOT NULL,
  unavailable_reason text,
  input_fingerprint text NOT NULL,
  feature_vector_fingerprint text NOT NULL,
  input_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_vector jsonb,
  market_fingerprint text NOT NULL,
  market_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  projected_margin double precision,
  projected_total double precision,
  home_win_probability double precision,
  confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  personnel_availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  weather_availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shadow_model_cutoffs_game_family_unique UNIQUE (game_id, model_family),
  CONSTRAINT shadow_model_cutoffs_family_check CHECK (model_family IN ('phase61', 'advanced_football', 'market_residual', 'ensemble')),
  CONSTRAINT shadow_model_cutoffs_status_check CHECK (status IN ('available', 'unavailable')),
  CONSTRAINT shadow_model_cutoffs_chronology_check CHECK (cutoff_at < kickoff_time AND prediction_at <= cutoff_at),
  CONSTRAINT shadow_model_cutoffs_availability_check CHECK (
    (status = 'available' AND unavailable_reason IS NULL AND projected_margin IS NOT NULL
      AND projected_total IS NOT NULL AND home_win_probability IS NOT NULL AND feature_vector IS NOT NULL)
    OR
    (status = 'unavailable' AND unavailable_reason IS NOT NULL AND projected_margin IS NULL
      AND projected_total IS NULL AND home_win_probability IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS shadow_model_cutoffs_season_idx
  ON shadow_model_cutoffs (season, kickoff_time, model_family);

CREATE TABLE IF NOT EXISTS shadow_model_grades (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shadow_cutoff_id integer NOT NULL REFERENCES shadow_model_cutoffs(id),
  actual_home_score integer NOT NULL,
  actual_away_score integer NOT NULL,
  actual_margin double precision NOT NULL,
  actual_total double precision NOT NULL,
  home_win double precision,
  margin_absolute_error double precision,
  total_absolute_error double precision,
  brier_score double precision,
  log_loss double precision,
  ats_outcome text,
  total_outcome text,
  moneyline_outcome text,
  market_difference jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_return jsonb NOT NULL DEFAULT '{}'::jsonb,
  graded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shadow_model_grades_cutoff_unique UNIQUE (shadow_cutoff_id),
  CONSTRAINT shadow_model_grades_score_check CHECK (
    actual_margin = actual_home_score - actual_away_score
    AND actual_total = actual_home_score + actual_away_score
    AND (home_win IS NULL OR home_win IN (0, 1))
  )
);
CREATE INDEX IF NOT EXISTS shadow_model_grades_graded_at_idx ON shadow_model_grades (graded_at, id);

CREATE TABLE IF NOT EXISTS evaluation_baseline_manifests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manifest_version text NOT NULL,
  source_uri text NOT NULL,
  source_checksum text NOT NULL,
  parser_version text NOT NULL,
  filter_version text NOT NULL,
  evaluation_version text NOT NULL,
  eligible_game_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  retained_prediction_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest_checksum text NOT NULL,
  reproducibility_status text NOT NULL,
  limitation text,
  diagnosis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_baseline_manifest_version_unique UNIQUE (manifest_version),
  CONSTRAINT evaluation_baseline_manifest_checksum_unique UNIQUE (manifest_checksum),
  CONSTRAINT evaluation_baseline_manifest_status_check CHECK (
    reproducibility_status IN ('reproducible', 'irrecoverable_historical_limitation')
  )
);

CREATE OR REPLACE FUNCTION reject_shadow_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shadow model evaluation evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shadow_model_cutoffs_immutable ON shadow_model_cutoffs;
CREATE TRIGGER shadow_model_cutoffs_immutable BEFORE UPDATE OR DELETE ON shadow_model_cutoffs
FOR EACH ROW EXECUTE FUNCTION reject_shadow_evidence_mutation();
DROP TRIGGER IF EXISTS shadow_model_grades_immutable ON shadow_model_grades;
CREATE TRIGGER shadow_model_grades_immutable BEFORE UPDATE OR DELETE ON shadow_model_grades
FOR EACH ROW EXECUTE FUNCTION reject_shadow_evidence_mutation();
DROP TRIGGER IF EXISTS evaluation_baseline_manifests_immutable ON evaluation_baseline_manifests;
CREATE TRIGGER evaluation_baseline_manifests_immutable BEFORE UPDATE OR DELETE ON evaluation_baseline_manifests
FOR EACH ROW EXECUTE FUNCTION reject_shadow_evidence_mutation();