ALTER TABLE "team_game_stats"
  ADD COLUMN IF NOT EXISTS "pass_dropbacks" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pass_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rush_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pass_epa_per_dropback" double precision,
  ADD COLUMN IF NOT EXISTS "rush_epa_per_rush" double precision,
  ADD COLUMN IF NOT EXISTS "passing_success_rate" double precision,
  ADD COLUMN IF NOT EXISTS "rushing_success_rate" double precision,
  ADD COLUMN IF NOT EXISTS "sack_rate_allowed" double precision,
  ADD COLUMN IF NOT EXISTS "early_down_pass_rate" double precision,
  ADD COLUMN IF NOT EXISTS "early_down_success_rate" double precision,
  ADD COLUMN IF NOT EXISTS "early_down_epa_per_play" double precision,
  ADD COLUMN IF NOT EXISTS "seconds_per_play" double precision,
  ADD COLUMN IF NOT EXISTS "pass_epa_allowed" double precision,
  ADD COLUMN IF NOT EXISTS "rush_epa_allowed" double precision,
  ADD COLUMN IF NOT EXISTS "pass_success_rate_allowed" double precision,
  ADD COLUMN IF NOT EXISTS "rush_success_rate_allowed" double precision,
  ADD COLUMN IF NOT EXISTS "defensive_sack_rate" double precision,
  ADD COLUMN IF NOT EXISTS "early_down_defensive_epa" double precision,
  ADD COLUMN IF NOT EXISTS "explosive_pass_rate_allowed" double precision,
  ADD COLUMN IF NOT EXISTS "explosive_rush_rate_allowed" double precision;

ALTER TABLE "pregame_team_features"
  ADD COLUMN IF NOT EXISTS "feature_audit" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "qb_game_stats" (
  "game_id" text NOT NULL,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "player_id" text NOT NULL,
  "team_id" text NOT NULL,
  "opponent_team_id" text NOT NULL,
  "dropbacks" integer NOT NULL DEFAULT 0,
  "pass_attempts" integer NOT NULL DEFAULT 0,
  "completions" integer NOT NULL DEFAULT 0,
  "pass_epa" double precision NOT NULL DEFAULT 0,
  "pass_successes" integer NOT NULL DEFAULT 0,
  "interceptions" integer NOT NULL DEFAULT 0,
  "sacks" integer NOT NULL DEFAULT 0,
  "rush_attempts" integer NOT NULL DEFAULT 0,
  "rush_epa" double precision NOT NULL DEFAULT 0,
  "participation_evidence" text,
  "source_updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("game_id", "player_id")
);
CREATE INDEX IF NOT EXISTS "qb_game_stats_team_idx"
  ON "qb_game_stats" ("team_id", "season", "week");