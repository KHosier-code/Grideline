CREATE TABLE IF NOT EXISTS weekly_reports (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL,
 season integer NOT NULL,
 week integer NOT NULL,
 generated_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL,
 CONSTRAINT weekly_reports_kind_generated_unique UNIQUE (kind, season, generated_at),
 CONSTRAINT weekly_reports_week_check CHECK (week BETWEEN 0 AND 22)
);
CREATE INDEX IF NOT EXISTS weekly_reports_kind_idx ON weekly_reports (kind, generated_at);
