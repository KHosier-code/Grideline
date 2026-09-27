---
name: Append-only evidence in route fixtures
description: Avoid uncleanable provider evidence in database-backed route tests.
---

Database-backed route tests that issue HTTP requests outside a single database transaction should not seed append-only provider snapshots as disposable fixtures. Prefer removable, uniquely identified evidence rows when a source-health gate needs fresh input. If the behavior under test specifically requires a real append-only identity lookup, keep its import outside the real provider namespace as well as using unique player IDs; it remains in the development database.

**Why:** An immutable provider snapshot insert succeeded during a route fixture run, but its cleanup DELETE was rejected by a database mutation-prevention trigger. HTTP handlers use separate pool connections, so wrapping fixture setup in a test-client rollback would not expose uncommitted rows to the route. A later one-player identity fixture in the real nflverse namespace became the globally latest import, hiding the actual full provider dataset from identity consumers despite unique fixture IDs.

**How to apply:** Check database mutation policies before choosing fixture tables; use isolated identifiers and cleanup for mutable tables. Do not disable immutability triggers just to clean up a test. Keep unavoidable immutable test evidence small, use a dedicated test namespace for imports, and confirm latest-real-import selection is unchanged.


For a test that must exercise the real persistence path in the provider namespace, prefer a disposable PostgreSQL schema with cloned receipt/payload tables and read-only views of any other needed tables. Start a fresh test process with that schema in its connection `search_path`, and drop the schema afterward. This keeps the real append-only namespace untouched, including when an assertion fails. A plain development-mode check does not isolate writes, and a transaction on one client cannot encompass application code that uses a pool or commits its own transactions.