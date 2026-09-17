---
name: Locked evaluation universes
description: Requirements for reproducible comparisons against retained model evaluation reports.
---

Retained evaluation evidence must include exact game identities, family-specific eligibility, and the source snapshot fingerprint. Matching aggregate sample counts is not enough to establish a comparable universe.

**Why:** Upstream historical sports datasets can change after an evaluation report is written. A later source snapshot produced the same family sample counts but a different fingerprint, so exact row equivalence could not be proven and the comparison had to fail closed.

**How to apply:** Persist game-level evaluation identities or a content-addressed source snapshot with every locked report. If neither is available and fingerprints differ, label the comparison non-comparable and do not issue an improvement claim.