CREATE TABLE IF NOT EXISTS consumer_game_alerts (
  user_id text NOT NULL,
  game_id text NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  baseline jsonb NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);