CREATE TABLE IF NOT EXISTS touchdown_pick_runs (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 season integer NOT NULL,
 week integer NOT NULL,
 generated_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 model_version text NOT NULL,
 evaluation jsonb NOT NULL DEFAULT '{}'::jsonb,
 picks jsonb NOT NULL,
 CONSTRAINT touchdown_pick_runs_week_generated_unique UNIQUE (season, week, generated_at),
 CONSTRAINT touchdown_pick_runs_week_check CHECK (week BETWEEN 1 AND 22)
);
CREATE INDEX IF NOT EXISTS touchdown_pick_runs_week_idx ON touchdown_pick_runs (season, week, generated_at);
CREATE TABLE IF NOT EXISTS touchdown_pick_results (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 season integer NOT NULL,
 week integer NOT NULL,
 player_id text NOT NULL,
 scored boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT touchdown_pick_results_player_week_unique UNIQUE (season, week, player_id)
);
