---
name: Generated contracts in publish
description: Why a successful local API build may not fix a failed Publish when generated contract outputs remain uncommitted.
---

When an OpenAPI change introduces new routes or schemas, regenerate and commit the generated API packages before retrying Publish. A local build can pass against uncommitted generated files even while the next publishing snapshot still uses older committed exports.

**Why:** A local successful build can see generated files that have not entered the committed publishing snapshot. The next build then lacks the exports expected by the new route.

**How to apply:** After a merged API contract change, compare the committed generated exports with the source imports, run the repository's code generation, verify local production builds, and ensure the generated outputs are included in the next publishing snapshot. Do not confuse a previous failed build still shown in history with a fresh retry.