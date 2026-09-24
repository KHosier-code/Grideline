---
name: Aggregate timestamp decoding
description: Runtime date handling for raw SQL aggregate expressions in Drizzle
---

When reading `max(timestamp)` through a raw `sql<Date | null>` selection, do not assume the result is a JavaScript `Date`. Parse and validate its runtime value before comparing it with a clock or calling `toISOString()`. A typed generic describes the TypeScript result but does not install a database driver decoder.

**Why:** A consumer feed-health endpoint typechecked and passed pure tests, but returned 503 at runtime because a raw SQL aggregate returned a string and the health serializer called `toISOString()` on it.

**How to apply:** Check any new raw SQL timestamp aggregate at the database boundary; prefer an explicit decoder or guarded conversion, and smoke-check an endpoint backed by actual database rows after implementation.