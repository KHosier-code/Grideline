-- @execute-once
CREATE TABLE IF NOT EXISTS odds_request_resolutions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id integer NOT NULL UNIQUE REFERENCES odds_api_requests(id),
  provider_outcome text NOT NULL CHECK (provider_outcome IN ('completed', 'failed')),
  billed_credits integer NOT NULL CHECK (billed_credits >= 0),
  verified_remaining integer NOT NULL CHECK (verified_remaining >= 0),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) >= 8),
  evidence_checked_at timestamptz NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS odds_spend_approvals (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resolution_id integer NOT NULL REFERENCES odds_request_resolutions(id),
  intent_key text NOT NULL UNIQUE,
  max_credits integer NOT NULL CHECK (max_credits > 0),
  approved_by text NOT NULL,
  approval_reference text NOT NULL CHECK (length(approval_reference) >= 8),
  approved_at timestamptz NOT NULL DEFAULT now(),
  consumed_by_request_id integer UNIQUE REFERENCES odds_api_requests(id)
);
CREATE OR REPLACE FUNCTION reject_odds_resolution_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'odds resolution evidence is immutable';
END $$;
CREATE TRIGGER odds_resolution_immutable BEFORE UPDATE OR DELETE ON odds_request_resolutions
  FOR EACH ROW EXECUTE FUNCTION reject_odds_resolution_mutation();
CREATE OR REPLACE FUNCTION guard_odds_approval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.consumed_by_request_id IS NOT NULL
     OR NEW.consumed_by_request_id IS NULL
     OR (to_jsonb(NEW) - 'consumed_by_request_id') <> (to_jsonb(OLD) - 'consumed_by_request_id') THEN
    RAISE EXCEPTION 'odds approval may only be consumed once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER odds_approval_single_use BEFORE UPDATE OR DELETE ON odds_spend_approvals
  FOR EACH ROW EXECUTE FUNCTION guard_odds_approval_mutation();