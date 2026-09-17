CREATE TABLE IF NOT EXISTS confidence_methodologies (
  confidence_version text PRIMARY KEY,
  weights jsonb NOT NULL,
  thresholds jsonb NOT NULL,
  normalization_rules jsonb NOT NULL,
  historical_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prediction_confidence_results (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_key text NOT NULL,
  confidence_version text NOT NULL REFERENCES confidence_methodologies(confidence_version),
  market text NOT NULL CHECK (market IN ('spread', 'moneyline', 'total')),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  label text NOT NULL CHECK (label IN ('Low', 'Moderate', 'Strong', 'Very Strong')),
  components jsonb NOT NULL,
  evidence jsonb NOT NULL,
  explanation text NOT NULL,
  downgrade_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prediction_confidence_results_key_unique UNIQUE (snapshot_key, confidence_version, market)
);
CREATE INDEX IF NOT EXISTS prediction_confidence_results_snapshot_idx
  ON prediction_confidence_results(snapshot_key, calculated_at);

CREATE OR REPLACE FUNCTION reject_confidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confidence methodology and results are append-only';
END;
$$;
DROP TRIGGER IF EXISTS confidence_methodologies_append_only ON confidence_methodologies;
CREATE TRIGGER confidence_methodologies_append_only
BEFORE UPDATE OR DELETE ON confidence_methodologies FOR EACH ROW
EXECUTE FUNCTION reject_confidence_mutation();
DROP TRIGGER IF EXISTS prediction_confidence_results_append_only ON prediction_confidence_results;
CREATE TRIGGER prediction_confidence_results_append_only
BEFORE UPDATE OR DELETE ON prediction_confidence_results FOR EACH ROW
EXECUTE FUNCTION reject_confidence_mutation();