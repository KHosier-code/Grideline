# Production immutability trigger installation

This is the reviewed, trigger-only Database-tool step for each Publish. Run it
in the production Database tool only after the managed Publish schema diff has
created or updated the tables and columns. Take a production checkpoint first.

The SQL below contains only trigger functions and trigger definitions. It must
not be added to application startup, a deployment hook, or a production
migration runner. Do not copy table, column, index, foreign-key, or constraint
DDL from the source migrations into this step.

```sql
CREATE OR REPLACE FUNCTION "prevent_weather_snapshot_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'weather forecast snapshots are append-only';
END;
$$;
DROP TRIGGER IF EXISTS "weather_forecast_snapshots_append_only" ON "weather_forecast_snapshots";
CREATE TRIGGER "weather_forecast_snapshots_append_only"
BEFORE UPDATE OR DELETE ON "weather_forecast_snapshots"
FOR EACH ROW EXECUTE FUNCTION "prevent_weather_snapshot_mutation"();

CREATE OR REPLACE FUNCTION reject_model_evaluation_prediction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model evaluation prediction evidence is immutable';
END;
$$;
DROP TRIGGER IF EXISTS model_evaluation_predictions_immutable ON "model_evaluation_predictions";
CREATE TRIGGER model_evaluation_predictions_immutable
BEFORE UPDATE OR DELETE ON "model_evaluation_predictions"
FOR EACH ROW EXECUTE FUNCTION reject_model_evaluation_prediction_mutation();

CREATE OR REPLACE FUNCTION reject_model_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
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
FOR EACH ROW EXECUTE FUNCTION reject_model_artifact_mutation();

CREATE OR REPLACE FUNCTION "prevent_sleeper_player_snapshot_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sleeper player snapshots are append-only';
END;
$$;
DROP TRIGGER IF EXISTS "sleeper_player_snapshots_append_only" ON "sleeper_player_snapshots";
CREATE TRIGGER "sleeper_player_snapshots_append_only"
BEFORE UPDATE OR DELETE ON "sleeper_player_snapshots"
FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_player_snapshot_mutation"();

CREATE OR REPLACE FUNCTION "prevent_sleeper_identity_mapping_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sleeper identity mappings are append-only';
END;
$$;
DROP TRIGGER IF EXISTS "sleeper_identity_mapping_runs_append_only" ON "sleeper_identity_mapping_runs";
CREATE TRIGGER "sleeper_identity_mapping_runs_append_only"
BEFORE UPDATE OR DELETE ON "sleeper_identity_mapping_runs"
FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_identity_mapping_mutation"();
DROP TRIGGER IF EXISTS "sleeper_identity_mappings_append_only" ON "sleeper_identity_mappings";
CREATE TRIGGER "sleeper_identity_mappings_append_only"
BEFORE UPDATE OR DELETE ON "sleeper_identity_mappings"
FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_identity_mapping_mutation"();

CREATE OR REPLACE FUNCTION "prevent_sleeper_crosswalk_evidence_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sleeper crosswalk evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS "sleeper_player_crosswalk_evidence_append_only" ON "sleeper_player_crosswalk_evidence";
CREATE TRIGGER "sleeper_player_crosswalk_evidence_append_only"
BEFORE UPDATE OR DELETE ON "sleeper_player_crosswalk_evidence"
FOR EACH ROW EXECUTE FUNCTION "prevent_sleeper_crosswalk_evidence_mutation"();

CREATE OR REPLACE FUNCTION "prevent_player_identity_evidence_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Player identity evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS "identity_source_imports_append_only" ON "identity_source_imports";
CREATE TRIGGER "identity_source_imports_append_only"
BEFORE UPDATE OR DELETE ON "identity_source_imports"
FOR EACH ROW EXECUTE FUNCTION "prevent_player_identity_evidence_mutation"();
DROP TRIGGER IF EXISTS "nflverse_player_identities_append_only" ON "nflverse_player_identities";
CREATE TRIGGER "nflverse_player_identities_append_only"
BEFORE UPDATE OR DELETE ON "nflverse_player_identities"
FOR EACH ROW EXECUTE FUNCTION "prevent_player_identity_evidence_mutation"();
DROP TRIGGER IF EXISTS "player_identity_crosswalk_append_only" ON "player_identity_crosswalk_revisions";
CREATE TRIGGER "player_identity_crosswalk_append_only"
BEFORE UPDATE OR DELETE ON "player_identity_crosswalk_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_player_identity_evidence_mutation"();

CREATE OR REPLACE FUNCTION reject_market_baseline_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'market baseline evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS market_baseline_runs_immutable ON "market_baseline_runs";
CREATE TRIGGER market_baseline_runs_immutable
BEFORE UPDATE OR DELETE ON "market_baseline_runs"
FOR EACH ROW EXECUTE FUNCTION reject_market_baseline_mutation();
DROP TRIGGER IF EXISTS market_baseline_events_immutable ON "market_baseline_events";
CREATE TRIGGER market_baseline_events_immutable
BEFORE UPDATE OR DELETE ON "market_baseline_events"
FOR EACH ROW EXECUTE FUNCTION reject_market_baseline_mutation();
DROP TRIGGER IF EXISTS market_baseline_quotes_immutable ON "market_baseline_quotes";
CREATE TRIGGER market_baseline_quotes_immutable
BEFORE UPDATE OR DELETE ON "market_baseline_quotes"
FOR EACH ROW EXECUTE FUNCTION reject_market_baseline_mutation();

CREATE OR REPLACE FUNCTION reject_confidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confidence methodology and results are append-only';
END;
$$;
DROP TRIGGER IF EXISTS confidence_methodologies_append_only ON confidence_methodologies;
CREATE TRIGGER confidence_methodologies_append_only
BEFORE UPDATE OR DELETE ON confidence_methodologies
FOR EACH ROW EXECUTE FUNCTION reject_confidence_mutation();
DROP TRIGGER IF EXISTS prediction_confidence_results_append_only ON prediction_confidence_results;
CREATE TRIGGER prediction_confidence_results_append_only
BEFORE UPDATE OR DELETE ON prediction_confidence_results
FOR EACH ROW EXECUTE FUNCTION reject_confidence_mutation();

CREATE OR REPLACE FUNCTION "prevent_verified_depth_evidence_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verified depth evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS "verified_depth_evidence_append_only" ON "verified_depth_evidence";
CREATE TRIGGER "verified_depth_evidence_append_only"
BEFORE UPDATE OR DELETE ON "verified_depth_evidence"
FOR EACH ROW EXECUTE FUNCTION "prevent_verified_depth_evidence_mutation"();

CREATE OR REPLACE FUNCTION reject_canonical_prediction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
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
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prediction grades are immutable';
END;
$$;
DROP TRIGGER IF EXISTS prediction_grade_immutable ON prediction_grades;
CREATE TRIGGER prediction_grade_immutable
BEFORE UPDATE OR DELETE ON prediction_grades
FOR EACH ROW EXECUTE FUNCTION reject_prediction_grade_mutation();
```

After this statement batch succeeds, start the published API and worker without
bypassing their production database startup gate. A successful
`release_security_evidence` row is recorded only after the transactional
mutation probes pass. If startup fails, do not weaken or skip the gate; compare
this reviewed block with the current migration definitions and restore the
checkpoint if the trigger installation must be rolled back.