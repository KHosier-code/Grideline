---
name: Function migration baselines
description: Avoid treating named database objects as proof that replacement function behavior is installed.
---

When a migration replaces a PL/pgSQL function behind an existing trigger, it must run once even if every table, index, and trigger name already exists. Do not infer that the function body is current from a trigger-name preflight.

**Why:** The development migration runner recorded a guard-strengthening migration as a verified baseline because both trigger names already existed, leaving the old function body in place. A subsequent force-execution migration was needed to repair the ledger-consistent development schema.

**How to apply:** For behavior-changing function replacements, use the migration runner's explicit one-time execution convention; inspect function definitions, not just trigger presence, when validating a release. Keep recorded migration checksums intact.