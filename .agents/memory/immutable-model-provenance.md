---
name: Immutable model provenance
description: Production model identities must refer to complete immutable inference contracts, not recipes rebuilt from mutable data.
---

A promoted model version is valid only when its ordered feature schema, preprocessing statistics, and fitted parameters were persisted together at training time. Missing legacy provenance must fail closed; it must not be reconstructed or backfilled by assumption.

**Why:** Rebuilding a model from repaired or refreshed historical rows under an existing version silently changes effective model behavior and makes snapshot provenance impossible to prove.

**How to apply:** Execute inference only from persisted fitted artifacts. Require snapshots and downstream reports to validate exact vector/schema/source provenance. Checksums must cover invariant training metadata as well as fitted state, and checksum-backed training-run evidence must be database-immutable. Keep unverifiable legacy rows auditable rather than reconstructing them.