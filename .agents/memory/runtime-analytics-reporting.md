---
name: Runtime analytics reporting
description: Why in-app analytics reports use a bounded first-party event copy alongside injected project analytics.
---

Self-serve admin analytics views must read from a privacy-safe first-party event store while continuing to emit the same bounded events to Replit Project Analytics.

**Why:** Replit's injected analytics warehouse can be queried by workspace analytics tools, but the running application has no supported runtime query API for that warehouse.

**How to apply:** For an in-app report, persist only allow-listed event names and dimensions, keep collection non-blocking, aggregate server-side over an explicit period, and protect report reads with administrator authorization.