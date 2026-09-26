---
name: Cleanup startup evidence
description: Durable first-attempt grace periods for worker-owned retention jobs
---

Use a persisted observation anchor when warning that a worker-owned cleanup has never attempted to run. Seed it before the API listens, even when a schema-first publish created the table without running SQL migrations. The SQL migration also seeds development. Process uptime or dashboard visit time cannot establish time since deployment.

**Why:** A disabled worker leaves no attempt record, and restarting the API resets in-memory clocks. An immediate warning would also mislabel a fresh install before the worker's first pass has time to finish.

**How to apply:** For future worker-owned jobs, distinguish no attempt within a bounded installation grace period from a missed recurring attempt after a known run. Verify the marker's column at startup and fail closed on incomplete schema; never let the first admin request start the grace period. Do not infer approval state or expose configuration values from the public health response.