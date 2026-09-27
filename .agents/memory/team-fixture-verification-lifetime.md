---
name: Team fixture verification lifetime
description: Why consumer schedule verification uses short-lived evidence instead of treating persisted games as proof
---

Only a recent, nonempty provider response can verify Team Evidence schedule coverage. When evidence is missing or delayed, return partial coverage quickly; do not infer completeness from the locally persisted schedule. Avoid carrying verified status across process restarts without a durable source identity and freshness policy.

**Why:** The persisted schedule is the thing being checked. Reusing it as independent proof, or retaining verification indefinitely, can silently allow incomplete weeks into analytics.

**How to apply:** When adding caching, polling, or persistent warm starts for Team Evidence, keep the provider fixture identity and expiration bound explicit and let absence or expiration remain unverified.