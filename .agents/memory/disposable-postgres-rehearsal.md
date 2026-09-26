---
name: Disposable PostgreSQL rehearsals
description: Environment constraints for short-lived local PostgreSQL startup tests
---

Run a disposable PostgreSQL cluster and its consumers within the same long-lived shell invocation (or a managed background task). A server started by one short shell call may be terminated before a later shell call begins.

**Why:** An apparently successful `pg_ctl start` was followed by connection refusal in the next invocation, despite a ready log. Keeping startup, assertions and teardown in one invocation made the rehearsal reproducible.

**How to apply:** Use a trap for shutdown and remove only the freshly created temporary directory. When checking `inet_server_addr()::text`, allow PostgreSQL's loopback CIDR rendering (`127.0.0.1/32`) as well as the bare loopback address; this is not permission for any non-loopback host.