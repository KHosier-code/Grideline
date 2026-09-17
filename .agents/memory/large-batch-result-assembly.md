---
name: Large batch result assembly
description: Safe assembly of large database query results in batch-oriented historical jobs.
---

Append large database result sets iteratively rather than passing an entire returned batch as variadic arguments to an array method.

**Why:** Multi-season personnel evidence can return enough rows for variadic spreading to exceed the JavaScript call-stack argument limit even though the database queries themselves succeed.

**How to apply:** In historical loaders and benchmarks, use loops or other non-variadic collection methods when joining query batches whose row count is data-dependent.