---
name: Completion handoff integrity
description: Distinguish a validation handoff changing source from an ordinary local build failure.
---

When completion validation reports syntax errors after a passing local typecheck, inspect the current committed diff against the preceding revision and repair any unrelated route changes before retrying.

**Why:** A completion attempt produced a committed consumer route with unrelated handlers damaged even though the local API had compiled and served those handlers immediately beforehand. Retrying validation without comparing the committed source would not have identified the regression.

**How to apply:** Compare the relevant route against its previous revision, verify that only intended handlers changed, rerun typecheck and a representative existing consumer endpoint, then restart the workflow once.