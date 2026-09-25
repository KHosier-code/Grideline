---
name: Selective cherry-pick verification
description: Why selective integrations across divergent branches require semantic checks even after conflicts are resolved
---

Treat a successful cherry-pick as a starting point, not proof of a coherent integration. When several independent consumer changes touch the same route and test files, inspect the combined route boundaries and test assertions, run typechecks and focused tests, and verify actual endpoint responses.

**Why:** Independent branches can alter nearby regions differently. A merge can finish without conflict markers but leave unrelated query logic inside an endpoint or fixture logic inside another test; syntax and ordinary merge status alone do not detect that.

**How to apply:** This matters whenever bounded changes are selected from divergent task branches rather than merging their complete ancestry. Prefer the known-good combined behavior as a reference while retaining only the intended scope on the release branch. Check commit ancestry separately from runtime behavior.