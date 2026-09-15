---
name: Publish diffs for unvalidated checks
description: How PostgreSQL NOT VALID constraints interact with Replit's development-to-production schema diff.
---

PostgreSQL check constraints created with `NOT VALID` must be validated in development before publishing when production does not yet have them.

**Why:** Replit's schema-diff generator can mis-serialize an unvalidated check constraint by appending `NOT VALID` after an extra closing parenthesis. The stored PostgreSQL constraint and source expression can both be valid while the generated publish statement fails to parse.

**How to apply:** First confirm existing development rows have no violations, then use a normal development migration with `VALIDATE CONSTRAINT`. Recompute the development-to-production diff and confirm the emitted checks no longer contain `NOT VALID`. Migration baseline verification must treat validation state as a requirement rather than checking only that the constraint exists.