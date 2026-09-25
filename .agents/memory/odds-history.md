---
name: Sportsbook capture constraints
description: User-required preservation and quota boundaries for odds capture.
---

Compare each observation with the latest state, never deduplicate against all historical states. Keep price-only changes and returns to earlier lines.

**Why:** The user requires complete movement history without consecutive duplicates; an all-time hash would lose A-B-A movement.

Quote-state time and provider-observation time are different. An unchanged
price remains an immutable duplicate, but consumer freshness may use a recent
observation only when persisted evidence proves the complete expected
book/market/side set with no rejections.

**Why:** Change-only storage made a fixed 15-minute gate suppress successfully
re-observed unchanged markets. Treating any successful request as fresh would
create the opposite safety failure because request-level evidence does not
prove a particular game or market was present.

**How to apply:** Preserve first-observed terminology, exclude post-kickoff observations from closing eligibility, and use fixture tests rather than repeated live requests. Keep freshness aligned with the configured paid-feed cadence and fail closed when the audit cannot identify complete relevant observations. Do not add live verification calls unnecessarily.