---
name: Recovery rehearsal evidence
description: How to prove blocked provider activity in an isolated worker rehearsal
---

In a bundled worker rehearsal, assert the persisted provider-run failure evidence rather than grepping console output for the original network-block error.

**Why:** The bundled logger can serialize an Error as an empty object, and a provider may intentionally wrap a blocked fetch as a generic network failure. A log substring check can fail even when the correct selected adapter ran and the guard blocked it.

**How to apply:** On a disposable, identity-marked database, check provider/job identity, failed status and error classification alongside unchanged nonselected tables and a seeded retention sentinel. Keep network blocking active for the entire process, not just a mocked adapter call.

An unchanged final row count cannot prove that a recovery avoided unrelated writes. Audit protected tables for attempted statements in the disposable rehearsal, even when they start empty.

**Why:** An update to a seeded row, or an insert later reversed by a delete, can leave counts unchanged while still mutating unrelated state.

**How to apply:** Add statement-level write audits around the actual worker run; assert no protected-table write attempts in addition to snapshot and metadata checks. Synthetic provider responses must remain exact-URL allow-listed while socket egress stays blocked.