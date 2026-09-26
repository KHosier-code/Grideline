---
name: Development data repair boundaries
description: Guarding one-off development backfills from accidental production writes
---

Do not treat `NODE_ENV=development` or an absent deployment flag as proof that a database write targets development. A package command can set the flag while the connection still points elsewhere. Remove one-off recovery writers after a verified development repair, or require independent attestation of the actual connected database before any reusable writer can mutate it.

**Why:** Environment labels and database destinations are independent; a development-labeled command can still use a production connection.

**How to apply:** For future data backfills, verify the connected database identity before writing, fail closed when that proof is unavailable, and avoid leaving unguarded repair CLIs in the runnable project.