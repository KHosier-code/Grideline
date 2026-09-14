-- Additive recurring synchronization state. This migration intentionally does
-- not touch historical rows or the existing NFLverse constraints.
ALTER TABLE data_sync_runs
  ADD COLUMN IF NOT EXISTS job_key text,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Injury history is latest-state deduped transactionally in application code.
-- Do not enforce global source-hash uniqueness: A-B-A is a legitimate
-- immutable history sequence.
ALTER TABLE injuries
  DROP CONSTRAINT IF EXISTS injuries_player_source_hash_unique;
CREATE INDEX IF NOT EXISTS injuries_latest_state_idx
  ON injuries (player_id, team_id, snapshot_timestamp, id);

ALTER TABLE odds_api_requests
  ADD COLUMN IF NOT EXISTS intent_key text;
ALTER TABLE odds_api_requests
  DROP CONSTRAINT IF EXISTS odds_api_requests_intent_key_unique;
DROP INDEX IF EXISTS odds_api_requests_intent_key_unique;
ALTER TABLE odds_api_requests
  ADD CONSTRAINT odds_api_requests_intent_key_unique UNIQUE (intent_key);

CREATE TABLE IF NOT EXISTS scheduler_jobs (
  job_key text PRIMARY KEY,
  provider text NOT NULL,
  kind text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  cadence text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_scheduled_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_result jsonb,
  lock_owner text,
  lock_acquired_at timestamptz,
  lock_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduler_jobs_due_idx
  ON scheduler_jobs (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS scheduler_jobs_lock_idx
  ON scheduler_jobs (lock_until);