CREATE TABLE IF NOT EXISTS "pregame_team_features" (
  "feature_version" text NOT NULL,
  "game_id" text NOT NULL,
  "team_id" text NOT NULL,
  "opponent_team_id" text NOT NULL,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "kickoff_time" timestamptz NOT NULL,
  "is_home" boolean NOT NULL,
  "features" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sample_counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "low_sample" boolean NOT NULL DEFAULT true,
  "source_cutoff" timestamptz NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("feature_version", "game_id", "team_id")
);
CREATE INDEX IF NOT EXISTS "pregame_features_game_idx"
  ON "pregame_team_features" ("game_id", "feature_version");
CREATE INDEX IF NOT EXISTS "pregame_features_team_kickoff_idx"
  ON "pregame_team_features" ("team_id", "kickoff_time");