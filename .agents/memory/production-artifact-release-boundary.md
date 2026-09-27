---
name: Production artifact release boundary
description: Publish does not automatically transfer development model rows or execute custom trigger migrations.
---

Artifact-backed model releases need an explicit, supported production import and immutability path; a normal Publish can leave development-only candidate rows and custom PostgreSQL triggers absent.

**Why:** A verified Phase 6.1 publish produced a healthy deployment and database, but production contained neither the expected candidate artifacts nor the custom immutability trigger even though both existed in development.

**How to apply:** Before calling a candidate production-ready, query the production catalog and candidate rows after Publish. Never infer production artifact availability from a successful build, development state, or a clean structural schema diff.

Release readiness must revalidate the complete approved payload from the persisted production row, not only its model version or self-consistent checksum. Application-only immutability is acceptable only when every update/delete path is absent and fitting fails closed outside explicit development/test.

**Why:** A conflicting but internally valid artifact could otherwise occupy an approved model version and pass generic integrity checks when the custom database trigger is unavailable.

**How to apply:** Keep imports append-only and idempotent, reject conflicts, expose the database-trigger limitation honestly, and require exact artifact ID/checksum/schema verification again before shadow readiness or manual promotion review.

For optional, operator-initiated append-only reviews, a missing custom production trigger should block the review write in its own transaction rather than take down unrelated public API routes. This is a release gate, not a replacement for database-level immutability against direct SQL access.

**Why:** Managed Publish preserved a retrospective review table and its constraints but omitted both its rejection trigger and the trigger function; startup-wide enforcement would make unrelated services unavailable.

**How to apply:** Check the live connection's catalog at the review write boundary while holding a table lock that conflicts with trigger-disabling DDL through the insert; an ordinary SELECT lock is insufficient. Explicitly report missing protection and seek a platform-supported database immutability path before claiming physical immutability.
