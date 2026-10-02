CREATE TABLE IF NOT EXISTS user_picks (
 user_id text NOT NULL,
 game_id text NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
 market text NOT NULL,
 side text NOT NULL,
 line real,
 price integer,
 sportsbook text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT user_picks_pkey PRIMARY KEY (user_id, game_id, market),
 CONSTRAINT user_picks_market_check CHECK (market IN ('moneyline', 'spread', 'total')),
 CONSTRAINT user_picks_side_check CHECK ((market = 'total' AND side IN ('over', 'under')) OR (market <> 'total' AND side IN ('home', 'away')))
);
CREATE INDEX IF NOT EXISTS user_picks_user_idx ON user_picks (user_id, created_at);
