---
name: Database health cancellation
description: How bounded admin health checks must stop PostgreSQL work when their shared route deadline expires.
---

Admin health checks that use the shared route deadline must propagate its abort signal into the database driver. A promise timeout alone only bounds the HTTP response; the PostgreSQL query can continue running and the pool client can remain occupied.

**Why:** During a database incident, abandoned health queries add load precisely when capacity is constrained. Returning a client to the pool while its query is still active is also unsafe.

**How to apply:** Cancel the active node-postgres query on abort, release the client with an error so the pool discards it, remove the abort listener on every completion path, and ensure the route owns and clears its deadline timer. Pool acquisition also needs its own abort race: if a queued waiter resolves after cancellation, release that late client with the abort error without dispatching a query.
