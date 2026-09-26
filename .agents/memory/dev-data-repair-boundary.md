---
name: Development data repair boundaries
description: Guarding one-off development backfills from accidental production writes
---

Do not treat `NODE_ENV=development` or an absent deployment flag as proof that a database write targets development. A package command can set the flag while the connection still points elsewhere. Remove one-off recovery writers after a verified development repair, or require independent attestation of the actual connected database before any reusable writer can mutate it.

**Why:** Environment labels and database destinations are independent; a development-labeled command can still use a production connection.

**How to apply:** For future data backfills, verify the connected database identity before writing, fail closed when that proof is unavailable, and avoid leaving unguarded repair CLIs in the runnable project.

Development startup may apply source-controlled migrations before opening the API port, but only after checking the connected database's identity independently of environment labels. Keep application schema readiness probes read-only in every environment.

**Why:** A reset can remove a table while the preview command still starts successfully; the resulting Home request fails instead of showing its normal evidence state. Production Publish remains the owner of production DDL.

**How to apply:** Do not replace a startup readiness failure with ad-hoc route-level DDL or an environment flag alone. Use the development migration runner for workspace resets and fail closed if its target is not verified.