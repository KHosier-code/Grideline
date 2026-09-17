---
name: Sleeper identity chronology
description: Rules for reproducible, conservative Sleeper-to-Gridline identity mapping.
---

Reconstruct the complete latest Sleeper player state as of the source cycle's capture time. A cycle identifier alone is incomplete because unchanged rows are intentionally deduplicated.

**Why:** Mapping only rows written in one cycle silently drops unchanged players. Separately, current Gridline evidence can evolve, so an immutable mapping run must record a deterministic fingerprint and capture time for the complete candidate set it evaluated.

**How to apply:** Bound Sleeper rows by capture time, fingerprint all mapping-relevant candidate evidence, version algorithm changes, and keep ambiguous IDs or unsupported team changes unmapped. Historical team membership is audit evidence, not current-team proof.