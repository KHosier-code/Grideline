---
name: Historical release evidence
description: How to extend pass-only release evidence without making false claims about older builds.
---

New pass-only release guard fields must remain null for releases created before
that guard was recorded. Never backfill historical evidence with a successful
value merely to satisfy a new schema shape.

**Why:** A successful backfill would claim that an older release passed a
specific check even though only the older aggregate policy result was recorded.

**How to apply:** When adding release evidence fields, constrain newly written
non-null values to the allow-listed pass result while preserving null as
"not recorded" for historical rows. Operator guidance must treat null as not a
pass.