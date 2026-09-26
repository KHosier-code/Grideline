CREATE TABLE IF NOT EXISTS player_recovery_receipt_cleanup (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_attempt_at timestamptz,
  last_attempt_status text CHECK (last_attempt_status IN ('success', 'failed')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  first_failure_at timestamptz,
  last_successful_at timestamptz,
  last_successful_deleted_receipts integer CHECK (last_successful_deleted_receipts >= 0)
);