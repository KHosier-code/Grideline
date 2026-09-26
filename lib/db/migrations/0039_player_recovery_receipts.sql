CREATE TABLE IF NOT EXISTS player_recovery_receipts (
  receipt_id text PRIMARY KEY,
  event text NOT NULL CHECK (event = 'player_recovery_receipt'),
  approved_feeds jsonb NOT NULL,
  target text NOT NULL CHECK (target IN ('attested_development_primary', 'attested_disposable_development_primary')),
  sync_run_job_key text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'partial_success', 'failed')),
  attempts jsonb NOT NULL,
  CONSTRAINT player_recovery_receipts_job_key_check CHECK (sync_run_job_key = 'operator-player-recovery:' || receipt_id),
  CONSTRAINT player_recovery_receipts_time_check CHECK (completed_at >= started_at)
);
CREATE INDEX IF NOT EXISTS player_recovery_receipts_completed_idx
  ON player_recovery_receipts (completed_at);

CREATE OR REPLACE FUNCTION reject_player_recovery_receipt_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Player recovery receipts are immutable';
END;
$$;
CREATE TRIGGER player_recovery_receipts_immutable
  BEFORE UPDATE ON player_recovery_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_player_recovery_receipt_update();