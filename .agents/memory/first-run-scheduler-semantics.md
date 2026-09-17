---
name: First-run scheduler semantics
description: How a newly introduced recurring feed should enter the durable scheduler without being mistaken for missed catch-up work.
---

Schedule a new recurring feed's first run as a near-future normal occurrence. If startup recovery sees it as already due, the scheduler may correctly classify it as work missed while stopped and skip it.

**Why:** Missed-job recovery is intentionally conservative so a restarted worker does not create a burst of stale catch-up requests. A brand-new feed still needs one prompt initial run before settling into its normal cadence.

**How to apply:** When registering a never-run recurring feed, distinguish its initial occurrence from missed historical work. Rearm an initialization skip once as a future normal occurrence without weakening recovery behavior for established jobs.

For one-shot jobs, the scheduler preparation pass must not retire an occurrence merely because it is due. Due jobs must remain enabled for the later claim or startup-recovery phase; retire them during preparation only when persisted schedule evidence proves the occurrence changed.

**Why:** Preparation runs before both normal claiming and startup recovery. Treating every elapsed occurrence as stale prevents normal one-shots from ever executing and hides the intended missed-run classification.

**How to apply:** Compare a recalculated one-shot time with its persisted `nextRunAt`. Equal times remain claimable; only a materially changed, newly elapsed time is retired as a flexed schedule miss.