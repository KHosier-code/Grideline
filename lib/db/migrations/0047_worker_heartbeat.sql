-- Normal worker liveness only. No provider credentials or job results live here.
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id integer PRIMARY KEY DEFAULT 1,
  owner text NOT NULL,
  started_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL
);