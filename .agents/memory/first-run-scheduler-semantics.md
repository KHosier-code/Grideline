---
name: First-run scheduler semantics
description: How a newly introduced recurring feed should enter the durable scheduler without being mistaken for missed catch-up work.
---

Schedule a new recurring feed's first run as a near-future normal occurrence. If startup recovery sees it as already due, the scheduler may correctly classify it as work missed while stopped and skip it.

**Why:** Missed-job recovery is intentionally conservative so a restarted worker does not create a burst of stale catch-up requests. A brand-new feed still needs one prompt initial run before settling into its normal cadence.

**How to apply:** When registering a never-run recurring feed, distinguish its initial occurrence from missed historical work. Rearm an initialization skip once as a future normal occurrence without weakening recovery behavior for established jobs.