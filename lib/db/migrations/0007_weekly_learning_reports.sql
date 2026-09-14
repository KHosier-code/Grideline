CREATE TABLE IF NOT EXISTS "weekly_learning_reports" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "report" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "narrative" text NOT NULL,
  CONSTRAINT "weekly_learning_reports_season_week_unique" UNIQUE ("season", "week")
);