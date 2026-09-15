CREATE OR REPLACE FUNCTION reject_model_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.model_artifact IS NOT NULL THEN
    RAISE EXCEPTION 'artifact-backed model training runs are immutable';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.model_artifact->'metadata'->>'artifactChecksum' IS NOT NULL
    AND OLD IS DISTINCT FROM NEW
  THEN
    RAISE EXCEPTION 'checksum-backed model training runs are fully immutable';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.model_artifact IS NOT NULL
    AND (
      OLD.model_version IS DISTINCT FROM NEW.model_version
      OR OLD.family IS DISTINCT FROM NEW.family
      OR OLD.algorithm IS DISTINCT FROM NEW.algorithm
      OR OLD.feature_version IS DISTINCT FROM NEW.feature_version
      OR OLD.training_seasons IS DISTINCT FROM NEW.training_seasons
      OR OLD.sample_policy IS DISTINCT FROM NEW.sample_policy
      OR OLD.sample_size IS DISTINCT FROM NEW.sample_size
      OR OLD.vector_feature_names IS DISTINCT FROM NEW.vector_feature_names
      OR OLD.vector_schema_fingerprint IS DISTINCT FROM NEW.vector_schema_fingerprint
      OR OLD.model_artifact IS DISTINCT FROM NEW.model_artifact
      OR OLD.trained_at IS DISTINCT FROM NEW.trained_at
    )
  THEN
    RAISE EXCEPTION 'artifact-backed model identity and fitted state are immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS model_training_runs_artifact_immutable ON model_training_runs;

CREATE TRIGGER model_training_runs_artifact_immutable
BEFORE UPDATE OR DELETE ON model_training_runs
FOR EACH ROW
EXECUTE FUNCTION reject_model_artifact_mutation();