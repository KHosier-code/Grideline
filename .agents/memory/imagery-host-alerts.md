---
name: Imagery host alerts
description: Why photo-host drift alerts use durable source provenance and limited operational metadata.
---

New photo-host alerts should compare a complete, validated roster release with prior validated source evidence, excluding the already-reviewed host. Alert once for the winning persisted release, not once per cache refresh or API process. Emit only bounded host names and row counts; never player identifiers, URLs, query strings or image bytes.

**Why:** An optional roster refresh can run after cache expiry or process restart. In-memory alert suppression would repeat warnings across restarts, while comparing to unvalidated or stale rows could hide an unexpected provider change. The host itself still carries no public-display permission.

**How to apply:** If imagery ingestion or hosting moves to a worker, retain serialized release-level comparison and a durable deduplication key. Keep notification metadata independent of consumer image eligibility.