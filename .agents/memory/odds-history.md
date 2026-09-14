---
name: Sportsbook capture constraints
description: User-required preservation and quota boundaries for odds capture.
---

Compare each observation with the latest state, never deduplicate against all historical states. Keep price-only changes and returns to earlier lines.

**Why:** The user requires complete movement history without consecutive duplicates; an all-time hash would lose A-B-A movement.

**How to apply:** Preserve first-observed terminology, exclude post-kickoff observations from closing eligibility, and use fixture tests rather than repeated live requests. The user explicitly limited live verification calls and requested no automatic odds polling in this implementation.