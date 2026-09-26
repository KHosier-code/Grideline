ALTER TABLE player_recovery_receipt_cleanup
  ADD COLUMN IF NOT EXISTS first_observed_at timestamptz NOT NULL DEFAULT now();

-- Start the grace period at migration time even if the worker never starts
-- and nobody opens the admin dashboard.
INSERT INTO player_recovery_receipt_cleanup (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;