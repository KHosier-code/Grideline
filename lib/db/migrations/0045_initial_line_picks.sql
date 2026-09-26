-- @execute-once
CREATE TABLE IF NOT EXISTS initial_line_picks (
 game_id text PRIMARY KEY, season integer NOT NULL, week integer NOT NULL,
 request_id integer NOT NULL, requested_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL, kickoff_time timestamptz NOT NULL,
 cutoff_at timestamptz NOT NULL, status text NOT NULL, reason text,
 winner_team_id text, winner_probability double precision, sportsbook text,
 quotes jsonb, models jsonb, feature_version text, vector_feature_names jsonb,
 vector_schema_fingerprint text, input_vector jsonb, input_source_evidence jsonb,
 prediction jsonb,
 CONSTRAINT initial_line_status_check CHECK (status IN ('locked','no_line','incomplete_market','missing_input','invalid_model','legacy_unattributed')),
 CONSTRAINT initial_line_chronology_check CHECK (requested_at <= cutoff_at AND cutoff_at = observed_at AND observed_at < kickoff_time),
 CONSTRAINT initial_line_complete_check CHECK (
  (status = 'locked' AND winner_team_id IS NOT NULL AND winner_probability > 0.5 AND winner_probability <= 1 AND sportsbook IS NOT NULL AND jsonb_array_length(quotes) = 4 AND models IS NOT NULL AND input_vector IS NOT NULL AND input_source_evidence IS NOT NULL AND prediction IS NOT NULL)
  OR (status <> 'locked' AND winner_team_id IS NULL))
);
CREATE TABLE IF NOT EXISTS initial_weekly_picks (
 season integer NOT NULL, week integer NOT NULL,
 game_id text NOT NULL REFERENCES initial_line_picks(game_id),
 selected_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT initial_weekly_picks_season_week_unique UNIQUE (season,week)
);
CREATE OR REPLACE FUNCTION reject_initial_pick_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'initial-line evidence is immutable';
END $$;
CREATE TRIGGER initial_line_immutable BEFORE UPDATE OR DELETE ON initial_line_picks FOR EACH ROW EXECUTE FUNCTION reject_initial_pick_mutation();
CREATE TRIGGER initial_weekly_immutable BEFORE UPDATE OR DELETE ON initial_weekly_picks FOR EACH ROW EXECUTE FUNCTION reject_initial_pick_mutation();