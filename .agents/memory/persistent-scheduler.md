---
name: Persistent scheduler ownership
description: Durable ownership and observability rules for recurring data refreshes.
---

Critical refresh jobs must run in a persistent background worker separate from the interactive API process. Database leases and the existing missed-job policy remain the coordination layer, and paid sportsbook jobs must not burst-catch-up after downtime.

**Why:** The API process can restart or sleep independently of recurring data collection; tying refreshes to request-serving uptime makes freshness depend on user traffic.

**How to apply:** Keep the worker as a long-running console service, let the API expose its status and job history, and describe worker ownership explicitly in Data Health instead of marking the system stale merely because the API does not own the scheduler timer.

Worker liveness is a separate observation from feed success. A recent worker heartbeat says only that the normal approved worker process has been observed; rehearsal/recovery processes must not imply normal scheduling is active. Missing or timed-out liveness checks are unknown, not healthy, and stale observations should warn before job deadlines pass.

**Why:** One-shot collection windows can be missed before an overdue job appears, while a running worker can still encounter provider failures.

**How to apply:** Keep heartbeat reads credential-free and read-only, preserve provider-specific health independently, and never activate a worker or provider as a side effect of a status request.