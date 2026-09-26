---
name: Development Admin browser identity
description: Constraints for ephemeral Clerk identities used by release-time Admin browser checks.
---

When provisioning a temporary Clerk user for browser checks, satisfy the development instance's normal user-creation requirements even if authentication itself uses a one-time sign-in ticket. In this instance, an external ID alone was rejected, an address at `example.invalid` was rejected, and an address at `example.com` without a password was rejected. A random `example.com` address **with** a random password succeeded in both the Admin-only and full release browser runs on September 26, 2026. Use random, undisclosed credentials and delete the user when the check ends.

**Why:** Clerk's user-creation policy is independent of the chosen browser sign-in strategy. Reusing a human Admin session or granting a persistent test account hides authorization failures and leaves credential material behind.

**How to apply:** Keep any temporary Admin allowlist scoped to the development process and test Clerk keys, with a short expiration and exact user identity. Never turn a browser test grant into a production permission or a shared session fixture. If creation policy changes, inspect only sanitized error codes, never the API error body or token.