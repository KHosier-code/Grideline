---
name: Retention state validation
description: Development validation prerequisite for worker-owned Usage Lab retention state.
---

Stateful Usage Lab retention tests must run after the development migration runner has applied the retention state table and its alert columns.

**Why:** Event cleanup can succeed while retention diagnostics silently fail to persist when the development database is behind the source-controlled schema, which masks alert and recovery behavior.

**How to apply:** Before trusting worker alert tests, apply development migrations with the repository migration runner; never treat missing-state persistence logs as a passing validation.