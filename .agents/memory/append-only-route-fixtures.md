---
name: Append-only evidence in route fixtures
description: Avoid uncleanable provider evidence in database-backed route tests.
---

Database-backed route tests that issue HTTP requests outside a single database transaction should not seed append-only provider snapshots as disposable fixtures. Prefer removable, uniquely identified evidence rows when a source-health gate needs fresh input.

**Why:** An immutable provider snapshot insert succeeded during a route fixture run, but its cleanup DELETE was rejected by a database mutation-prevention trigger. HTTP handlers use separate pool connections, so wrapping fixture setup in a test-client rollback would not expose uncommitted rows to the route.

**How to apply:** Check database mutation policies before choosing fixture tables; use isolated identifiers and cleanup for mutable tables. Do not disable immutability triggers just to clean up a test.