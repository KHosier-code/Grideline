CREATE TABLE IF NOT EXISTS "release_security_evidence" (
  "build_id" text PRIMARY KEY NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "select_one_result" integer NOT NULL,
  "verify_full_passed" boolean NOT NULL,
  CONSTRAINT "release_security_evidence_select_one_check"
    CHECK ("select_one_result" = 1),
  CONSTRAINT "release_security_evidence_verify_full_check"
    CHECK ("verify_full_passed" = true)
);