-- @execute-once
CREATE TABLE retrospective_weekly_reviews (
 season integer NOT NULL, week integer NOT NULL, status text NOT NULL,
 reason text, game_id text REFERENCES initial_line_picks(game_id),
 winner_team_id text, winner_probability double precision,
 cutoff_at timestamptz, evidence_id text, reviewer_id text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 CONSTRAINT retrospective_weekly_reviews_season_week_unique UNIQUE (season, week),
 CONSTRAINT retrospective_weekly_reviews_scope_check CHECK (season = 2026 AND week BETWEEN 1 AND 3),
 CONSTRAINT retrospective_weekly_reviews_state_check CHECK (
  (status = 'unavailable' AND reason IS NOT NULL AND game_id IS NULL AND winner_team_id IS NULL AND published_at IS NULL)
  OR (status IN ('reviewed','published') AND reason IS NULL AND game_id IS NOT NULL AND winner_team_id IS NOT NULL
      AND winner_probability > 0.5 AND cutoff_at IS NOT NULL AND evidence_id IS NOT NULL
      AND ((status = 'published') = (published_at IS NOT NULL))))
);
CREATE TRIGGER retrospective_weekly_reviews_immutable BEFORE UPDATE OR DELETE ON retrospective_weekly_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_initial_pick_mutation();