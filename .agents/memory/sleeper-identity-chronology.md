---
name: Sleeper identity chronology
description: Rules for reproducible, conservative Sleeper-to-Gridline identity mapping.
---

Reconstruct the complete latest Sleeper player state as of the source cycle's capture time. A cycle identifier alone is incomplete because unchanged rows are intentionally deduplicated.

**Why:** Mapping only rows written in one cycle silently drops unchanged players. Separately, current Gridline evidence can evolve, so an immutable mapping run must record a deterministic fingerprint and capture time for the complete candidate set it evaluated.

Never compare raw provider IDs across namespaces, even when both values are numeric. Same-namespace stable-ID equality may create append-only crosswalk evidence; later Sleeper-ID mapping may use only that verified evidence.

**Why:** Gridline player keys mix ESPN, GSIS, PFR, and fallback forms. Raw equality between a Sleeper ID and an unnamespaced Gridline key can create a false confidence-1.0 identity.

**How to apply:** Bound Sleeper rows by capture time, fingerprint all mapping-relevant candidate evidence, version algorithm changes, and keep ambiguous IDs or unsupported team changes unmapped. Historical team membership is audit evidence, not current-team proof.

Readiness gates must use canonical current-team rows and supported normalized `depth_chart_position` role slots, not broad historical depth rows or primary-position cohorts. Persist mapped, ambiguous, and unresolved counts for each required starter role.

**Why:** Broad depth coverage can look healthy while specific current starter roles remain unusable, so it cannot support a reproducible suitable/not-suitable decision.

**How to apply:** Version any cohort-definition change. Require explicit per-role gates for QB1, WR1-3, CB1-2, EDGE, LB, safety starters, OL evidence, and starter ambiguity.