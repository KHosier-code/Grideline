---
name: Feed scheduling constraints
description: Hosting and refresh choices for recurring NFL source ingestion
---

Use an always-running service for in-process feed scheduling, not a traffic-dependent autoscaling runtime.

**Why:** A timer cannot refresh sources while its process is asleep. The project uses a VM deployment configuration, but publishing remains a separate user action with hosting-cost implications.

**How to apply:** Preserve durable attempts and replica locks when changing scheduler hosting; do not mistake a working development timer for proof of unattended production execution.

Scheduled nflverse downloads must bypass the historical import cache.

**Why:** A valid file on disk can be an old weekly snapshot, so rerunning ingestion alone does not refresh data.

**How to apply:** Keep manual backfill cache reuse separate from recurring source refresh, and continue treating missing season coverage as a visible failure.