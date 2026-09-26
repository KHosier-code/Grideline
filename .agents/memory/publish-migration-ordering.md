---
name: Publish migration ordering evidence
description: Evidence standard for approving schema-first production launches.
---

Do not treat a documentation search summary as proof that a managed schema diff completes before a deployment's run command starts. Verify the cited official page or platform configuration actually states that ordering. A read-only application preflight can guarantee that no API or worker starts against missing schema, but it cannot guarantee the rollout will retry successfully if its parent is launched before the migration.

**Why:** A search answer asserted a before-run-command guarantee, while the official development/production database page only said schema changes are applied at publishing and recommended deployment previews. The distinction matters for availability even when the startup gate prevents unsafe writes.

**How to apply:** For additive production schema releases, require explicit platform sequencing evidence or an approved pre-deploy migration dependency, and inspect an isolated deployment preview or rollout logs before declaring migration-before-start verified. Keep fail-closed schema readiness checks as defense in depth, not as a substitute for ordering evidence.

For Replit-managed PostgreSQL, do **not** turn an unproven Publish ordering guarantee into a custom production migration script, build hook, or startup DDL. Managed Publish's reviewed schema diff is the supported production schema writer; use a read-only application startup gate to prevent unsafe child processes and require platform-specific proof for the remaining availability question.

**Why:** The managed database migration guidance explicitly prohibits app-owned production DDL even when a documentation search summary suggests generic pre-deploy migration commands. Such a command would bypass Publish's rename/data-loss review and run on every deployment.

**How to apply:** Distinguish managed from external databases before proposing a separate migration step. For managed databases, recommend only a confirmed platform-supported owner workflow, never a direct SQL workaround.

Do not assume a Publish cutover serializes old and new background workers. The publishing guide describes preparing the new version alongside the current one before URL promotion; it does not guarantee the old process exits before the new worker starts.

**Why:** A schema-first compatibility release would still be a code/worker release, and app-level schema readiness does not prevent overlapping workers from initiating different scheduled jobs.

**How to apply:** Before relying on staged Publish for a worker-backed VM, obtain deployment-specific handover guarantees or independently enforce/process-test singleton ownership, then compare provider run evidence across the cutover. Per-job leases are not a global worker singleton.

When the live worker predates a new global lock, the lock cannot fence that older process. Keep the new worker disabled by default until the old process is independently confirmed retired; after activation, retain session ownership until the worker can no longer initiate in-flight work.

**Why:** An uncooperative old worker can still schedule a different provider job while the new worker holds its own lock. Explicitly releasing a lock while asynchronous work is still running also permits premature takeover.

**How to apply:** Treat owner activation and old-worker retirement as a separate release gate. Test new/new lock contention and session-loss failover, but do not present those tests as proof of old/new exclusion or remote exactly-once effects.