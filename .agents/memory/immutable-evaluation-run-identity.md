---
name: Immutable evaluation run identity
description: How append-only evaluation identities must account for all reproducibility inputs.
---

An immutable evaluation run identity must fingerprint both external evidence and
the complete feature/evaluation inputs. Family model versions must also be
unique to that evaluation run, even when the fitted training artifact is
unchanged.

**Why:** A source correction, eligibility change, or holdout correction can
require a new append-only run while preserving the same training fit. Reusing
the model version either collides with unique evidence or makes a fresh report
disagree with previously persisted rows.

**How to apply:** For append-only evaluations, include all fields that affect
filtering, fitting, retained evidence, matching, or reporting in the run
fingerprint. Bind each evaluation model/evidence identity to that run, and make
same-input reruns idempotent without overwriting prior evidence.