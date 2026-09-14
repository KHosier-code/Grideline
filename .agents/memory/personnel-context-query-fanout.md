---
name: Personnel context query fan-out
description: Resource-safety rule for Phase 7 context calculation in live and scheduled paths.
---

Bound concurrent personnel-context calculations, and calculate shared game context once per game rather than once per team.

**Why:** Each context calculation performs several database reads. Unbounded slate-wide fan-out and duplicate home/away calculations can exhaust the connection pool, making unrelated live API requests wait or fail.

**How to apply:** Any endpoint or worker that evaluates a full slate must use bounded concurrency. If both team rows consume the same game-level context, reuse one cutoff-safe result while preserving separate immutable team rows.