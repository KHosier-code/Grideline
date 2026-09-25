---
name: Managed production custom DDL
description: Documentation and permission limits when considering operator-installed custom PostgreSQL guards.
---

Replit's public My Data documentation describes a production SQL runner and Edit toggle, but does not explicitly guarantee PL/pgSQL function creation, trigger creation, or atomic multi-statement transactions on the production writer. Do not interpret general “run SQL commands” language or an AI-generated docs-search summary as confirmation for these exact statements. A read-only production replica's privilege flags cannot validate the UI writer's permissions.

**Why:** Documentation searches gave contradictory yes/no answers for custom trigger DDL while their linked primary source pages contained no explicit statement about those operations. The normal Publish schema diff omitted existing custom trigger differences.

**How to apply:** Before recommending a production custom-function/trigger installation, obtain explicit platform/operator confirmation of the writer path, privileges, transactional behavior, and maintenance controls. Keep read-only catalog preflight separate from executing DDL; do not route production changes through app startup, development migration runners, or the agent's read-only replica.