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

For an immutable weekly choice, rank the verified locks available after a
successful weekly pull rather than waiting for every scheduled game to yield
an outcome. Later games cannot replace that first saved selection.

**Why:** A feed can omit one matchup indefinitely; waiting for the full slate
would strand an otherwise legitimate weekly pick. Choosing once after the
completed pull makes the eligibility window explicit and stable.

**How to apply:** Keep deterministic rank/tie-breaks and save the weekly choice
once. Report missing initial evidence separately; do not backfill an earlier
game's failed first-pull decision from later quotes or refreshed inputs.