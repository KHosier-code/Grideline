ALTER TABLE "release_security_evidence"
  ADD COLUMN IF NOT EXISTS "connectivity_passed" boolean,
  ADD COLUMN IF NOT EXISTS "tls_passed" boolean,
  ADD COLUMN IF NOT EXISTS "snapshot_update_guard_passed" boolean,
  ADD COLUMN IF NOT EXISTS "snapshot_delete_guard_passed" boolean,
  ADD COLUMN IF NOT EXISTS "grade_update_guard_passed" boolean,
  ADD COLUMN IF NOT EXISTS "grade_delete_guard_passed" boolean;

ALTER TABLE "release_security_evidence"
  ADD CONSTRAINT "release_security_evidence_connectivity_check"
    CHECK ("connectivity_passed" = true),
  ADD CONSTRAINT "release_security_evidence_tls_check"
    CHECK ("tls_passed" = true),
  ADD CONSTRAINT "release_security_evidence_snapshot_update_check"
    CHECK ("snapshot_update_guard_passed" = true),
  ADD CONSTRAINT "release_security_evidence_snapshot_delete_check"
    CHECK ("snapshot_delete_guard_passed" = true),
  ADD CONSTRAINT "release_security_evidence_grade_update_check"
    CHECK ("grade_update_guard_passed" = true),
  ADD CONSTRAINT "release_security_evidence_grade_delete_check"
    CHECK ("grade_delete_guard_passed" = true);