ALTER TABLE prediction_confidence_results
  ADD COLUMN IF NOT EXISTS evidence_fingerprint text;

UPDATE prediction_confidence_results
SET evidence_fingerprint = md5(
  snapshot_key || ':' || confidence_version || ':' || market || ':' || calculated_at::text
)
WHERE evidence_fingerprint IS NULL;

ALTER TABLE prediction_confidence_results
  ALTER COLUMN evidence_fingerprint SET NOT NULL;

ALTER TABLE prediction_confidence_results
  DROP CONSTRAINT IF EXISTS prediction_confidence_results_key_unique;

ALTER TABLE prediction_confidence_results
  ADD CONSTRAINT prediction_confidence_results_evidence_unique
  UNIQUE (snapshot_key, confidence_version, market, evidence_fingerprint);