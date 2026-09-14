---
name: Clerk environment separation
description: Replit-managed Clerk keeps development and production users separate, which affects administrator ID configuration.
---

Replit-managed Clerk development and production environments have separate user stores, so the same person receives different Clerk user IDs in each environment. Secret tooling confirms presence but does not reveal existing secret values.

**Why:** A user can authenticate successfully in production while failing the application’s administrator check when an ID from development is the only configured identity. Replacing an opaque existing admin list risks removing valid administrators.

**How to apply:** Preserve the existing admin secret and use an additive production-only mapping when authorizing a newly verified production Clerk user. Verify the result in the published app after republishing.