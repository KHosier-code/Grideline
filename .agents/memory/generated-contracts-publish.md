---
name: Generated contracts in publish
description: Why a successful local API build may not fix a failed Publish when generated contract outputs remain uncommitted.
---

When an OpenAPI change introduces new routes or schemas, regenerate and commit the generated API packages before retrying Publish. A local build can pass against uncommitted generated files even while the next publishing snapshot still uses older committed exports.

**Why:** A saved-games route imported generated schemas that were present only after local code generation; the failed publishing build could not find them in its source snapshot. A local successful build alone did not establish that the fix was included in the committed tree.

**How to apply:** After a merged API contract change, compare the committed generated exports with the source imports, run the repository's code generation, verify local production builds, and ensure the generated outputs are included in the next publishing snapshot. Do not confuse a previous failed build still shown in history with a fresh retry.