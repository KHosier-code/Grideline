---
name: Singleton integration-test isolation
description: How to keep parallel database-backed integration tests from racing on singleton rows.
---

When database-backed integration tests mutate a singleton row, coordinate the test processes with a named PostgreSQL session-level advisory lock held for the fixture's lifetime; in-process test concurrency settings do not protect separate Node test files.

**Why:** The repository's normal Node test mode runs files in parallel processes, while a singleton row remains shared in PostgreSQL. A test-local or in-memory lock cannot prevent another process from replacing that row.

**How to apply:** Use one stable lock name in every test file that reads or replaces the singleton, keep the lock on a checked-out pool client, and unlock/release it before ending the pool.