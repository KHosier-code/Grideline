---
name: Paid odds reconciliation boundary
description: Provider-side billing reconciliation is separate from successful odds ingestion and a new spend approval.
---

An ambiguous paid request must remain blocked until an operator verifies its actual provider outcome, cost and current remaining quota. A provider receipt that the request completed must **not** turn an unprocessed response into a successful Gridline capture, nor attribute older quotes as initial lines. The next scheduled request needs its own exact, finite, one-use spending approval.

**Why:** A process can die after admission or even after provider billing, without saving a response. Recovered sync-run failure alone proves neither billing nor provider outcome. Replaying or changing the old ledger status could double-charge or manufacture first-line provenance.

**How to apply:** Keep provider reconciliation and application ingestion as distinct facts; retain original request cutoff/status, quote history and initial-line decisions. If provider-specific evidence is unavailable, leave automatic admission blocked. A user who explicitly accepts a possible duplicate charge may authorize only a separate, one-use, audited manual attempt with a fresh zero-cost quota check; it does not resolve the old request or unlock recurring captures. Once reconciliation starts, require a new exact one-use approval for every later paid intent, even after a successful approved capture; otherwise the next scheduled call can silently resume spending. Require worker ownership, writable-database identity, live queue/schema and budget approval separately before enabling production capture.