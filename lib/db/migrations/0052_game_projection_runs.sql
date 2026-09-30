CREATE TABLE IF NOT EXISTS game_projection_runs (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 season integer NOT NULL,
 week integer NOT NULL,
 generated_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 model_version text NOT NULL,
 evaluation jsonb NOT NULL DEFAULT '{}'::jsonb,
 games jsonb NOT NULL,
 teams jsonb NOT NULL DEFAULT '[]'::jsonb,
 CONSTRAINT game_projection_runs_week_generated_unique UNIQUE (season, week, generated_at),
 CONSTRAINT game_projection_runs_week_check CHECK (week BETWEEN 1 AND 22)
);
CREATE INDEX IF NOT EXISTS game_projection_runs_week_idx ON game_projection_runs (season, week, generated_at);
