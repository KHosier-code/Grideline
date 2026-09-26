CREATE TABLE IF NOT EXISTS "imagery_reviews" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "player_id" text NOT NULL,
  "provider" text NOT NULL,
  "source_hash" text NOT NULL,
  "image_url" text NOT NULL,
  "image_hash" text NOT NULL,
  "rights_evidence" text NOT NULL,
  "decision" text NOT NULL CHECK ("decision" IN ('approved', 'rejected')),
  "reason" text NOT NULL,
  "reviewer_id" text NOT NULL,
  "reviewed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "imagery_reviews_player_latest_idx" ON "imagery_reviews" ("player_id", "id");
CREATE OR REPLACE FUNCTION reject_imagery_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'imagery reviews are append-only';
END $$;
CREATE TRIGGER imagery_reviews_immutable BEFORE UPDATE OR DELETE ON imagery_reviews
FOR EACH ROW EXECUTE FUNCTION reject_imagery_review_mutation();