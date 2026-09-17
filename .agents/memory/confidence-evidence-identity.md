---
name: Confidence evidence identity
description: Durable rules for versioning and persisting market-specific confidence calculations.
---

Confidence is separate for spread, moneyline, and total. Persisted results must
be append-only and identified by both methodology version and the complete
calculation evidence; a snapshot/version/market key alone is insufficient when
current market observations or freshness can change.

**Why:** Otherwise the first calculation can permanently win while later
consumer market data changes, producing internally inconsistent and
non-reproducible output.

**How to apply:** Keep public reads read-only. Run persistence through a
controlled operation, fingerprint the calculation evidence, bound all revision
inputs to the selected pre-kickoff snapshot, and create a new methodology
version rather than rewriting earlier records.