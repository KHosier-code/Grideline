---
name: Persistent scheduler ownership
description: Durable ownership and observability rules for recurring data refreshes.
---

Critical refresh jobs must run in a persistent background worker separate from the interactive API process. Database leases and the existing missed-job policy remain the coordination layer, and paid sportsbook jobs must not burst-catch-up after downtime.

**Why:** The API process can restart or sleep independently of recurring data collection; tying refreshes to request-serving uptime makes freshness depend on user traffic.

**How to apply:** Keep the worker as a long-running console service, let the API expose its status and job history, and describe worker ownership explicitly in Data Health instead of marking the system stale merely because the API does not own the scheduler timer.