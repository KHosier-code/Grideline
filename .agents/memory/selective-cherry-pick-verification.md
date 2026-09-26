---
name: Selective cherry-pick verification
description: Why selective integrations across divergent branches require semantic checks even after conflicts are resolved
---

Treat a successful cherry-pick or automatic task rebase as a starting point, not proof of a coherent integration. When several independent consumer changes touch the same route and test files, inspect the combined route boundaries and test assertions, run typechecks and focused tests, and verify actual endpoint responses.

**Why:** Independent branches can alter nearby regions differently. A merge can finish without conflict markers but leave unrelated query logic inside an endpoint or fixture logic inside another test; syntax and ordinary merge status alone do not detect that. A conflict-resolution tool or automatic completion rebase can also replay a broken integration after the isolated working tree passed a typecheck and route tests.

**How to apply:** This matters whenever bounded changes are selected from divergent task branches rather than merging their complete ancestry. Prefer the known-good isolated commit as a reference while retaining later unrelated main changes. Check commit ancestry separately from runtime behavior, and run validation against the committed post-rebase tree, not only the pre-merge working tree.