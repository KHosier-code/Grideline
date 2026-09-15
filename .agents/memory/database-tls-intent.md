---
name: Database TLS intent
description: How to preserve explicit PostgreSQL TLS behavior across local development and managed production.
---

Use the connection URL's declared SSL mode to choose database TLS behavior. A URL
without an SSL mode is the local development path and must explicitly disable
TLS; a URL that requests TLS must use full certificate and hostname verification.
Do not infer this from the database hostname.

**Why:** Replit's local development database proxy can use a non-loopback
hostname while not supporting TLS. Production URLs request TLS and must retain
the driver's current full-verification behavior across dependency upgrades.

**How to apply:** Any new PostgreSQL connection path or database tooling must
share the same URL normalization policy. Verify changes with a metadata-free
query and check startup logs for connection-string compatibility warnings.