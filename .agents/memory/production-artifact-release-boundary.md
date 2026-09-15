---
name: Production artifact release boundary
description: Publish does not automatically transfer development model rows or execute custom trigger migrations.
---

Artifact-backed model releases need an explicit, supported production import and immutability path; a normal Publish can leave development-only candidate rows and custom PostgreSQL triggers absent.

**Why:** A verified Phase 6.1 publish produced a healthy deployment and database, but production contained neither the expected candidate artifacts nor the custom immutability trigger even though both existed in development.

**How to apply:** Before calling a candidate production-ready, query the production catalog and candidate rows after Publish. Never infer production artifact availability from a successful build, development state, or a clean structural schema diff.