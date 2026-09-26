CREATE TABLE IF NOT EXISTS saved_games (
  user_id text NOT NULL,
  game_id text NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);