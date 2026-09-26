-- Derived, replaceable nflverse PBP opportunity facts. A missing source
-- update timestamp is kept NULL; ingested_at records when Gridline processed it.
CREATE TABLE IF NOT EXISTS red_zone_player_game_facts (
  game_id text NOT NULL,
  source_game_id text NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  season_type text NOT NULL,
  player_id text NOT NULL,
  player_name text,
  position text,
  team_id text NOT NULL,
  opponent_team_id text NOT NULL,
  zone integer NOT NULL,
  targets integer NOT NULL DEFAULT 0,
  carries integer NOT NULL DEFAULT 0,
  receiving_touchdowns integer NOT NULL DEFAULT 0,
  rushing_touchdowns integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'nflverse_pbp',
  source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_zone_player_game_facts_pkey PRIMARY KEY (game_id, player_id, team_id, zone),
  CONSTRAINT red_zone_player_game_zone_check CHECK (zone IN (5, 10, 20)),
  CONSTRAINT red_zone_player_game_counts_check CHECK (
    targets >= 0 AND carries >= 0 AND receiving_touchdowns >= 0 AND rushing_touchdowns >= 0
  )
);

CREATE INDEX IF NOT EXISTS red_zone_player_game_season_idx
  ON red_zone_player_game_facts (season, season_type, player_id, week);
CREATE INDEX IF NOT EXISTS red_zone_player_game_team_idx
  ON red_zone_player_game_facts (season, team_id, zone);

CREATE TABLE IF NOT EXISTS red_zone_team_game_facts (
  game_id text NOT NULL,
  source_game_id text NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  season_type text NOT NULL,
  team_id text NOT NULL,
  opponent_team_id text NOT NULL,
  zone integer NOT NULL,
  targets integer NOT NULL DEFAULT 0,
  carries integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'nflverse_pbp',
  source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_zone_team_game_facts_pkey PRIMARY KEY (game_id, team_id, zone),
  CONSTRAINT red_zone_team_game_zone_check CHECK (zone IN (5, 10, 20)),
  CONSTRAINT red_zone_team_game_counts_check CHECK (targets >= 0 AND carries >= 0)
);

CREATE INDEX IF NOT EXISTS red_zone_team_game_season_idx
  ON red_zone_team_game_facts (season, season_type, team_id, week);