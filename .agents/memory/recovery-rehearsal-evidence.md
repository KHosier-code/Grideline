---
name: Recovery rehearsal evidence
description: How to prove blocked provider activity in an isolated worker rehearsal
---

In a bundled worker rehearsal, assert the persisted provider-run failure evidence rather than grepping console output for the original network-block error.

**Why:** The bundled logger can serialize an Error as an empty object, and a provider may intentionally wrap a blocked fetch as a generic network failure. A log substring check can fail even when the correct selected adapter ran and the guard blocked it.

**How to apply:** On a disposable, identity-marked database, check provider/job identity, failed status and error classification alongside unchanged nonselected tables and a seeded retention sentinel. Keep network blocking active for the entire process, not just a mocked adapter call.