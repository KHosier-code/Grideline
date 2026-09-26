# Gridline production release preparation

**Decision (2026-09-25 America/Chicago): HOLD.** This work changed development source only. It did not publish, change production data or database bindings, restore a database, restart the live worker, launch a second production worker, or contact a paid provider.

## 1. Production recovery

**Database identity.** The managed production **read replica** identifies itself as `neondb.public`; it is in recovery and still has neither red-zone fact table. Its latest `release_security_evidence` build ID is `0f28232cb67a-2026-09-25T21:24:36.077Z`, checked at `2026-09-25T21:42:50.983814Z`. The live deployment logs show the *same* build ID and smoke-check time, then API health and the old worker starting at `2026-09-25T21:43:02Z`. The published build remains successful on a VM; the production parent passes one inherited database environment to both children. Together these correlate the deployed API and worker with the managed `neondb` database rather than merely assuming it from a database name. They are not a direct inspection of the live process's connection string, which must remain private.

**Recovery-point status: NOT VERIFIED.** [Replit's recovery documentation](https://docs.replit.com/features/data-and-storage/data-recovery) describes production point-in-time restore (seven days by default; Core up to seven days and Pro/Enterprise up to 28, subject to settings) and optional daily scheduled backups. Neither a specific currently restorable point nor the configured retention/backup schedule was visible in the read-only access available here. The documentation describes switching the production database to selected backup data; it does **not** document an isolated restore target or a separately exportable, restorable backup for this project. It says scheduled-backup restoration does not delete the current data, but does not document how to merge writes from the prior active state into the selected restored state.

**Restore-test result: NOT RUN.** No verified isolated target or supported non-destructive restore control was available. Restoring the live database would violate this brief. A development transaction testing a schema diff is not a production backup/restore test.

**Write preservation.** A restore to an earlier point would make later legitimate writes **absent from the newly active historical state**, even if a platform-retained prior state still exists. Do not assume they are automatically replayed or that the old state is indefinitely retrievable. Before any production recovery, verify a platform-supported **separate, restorable copy** of the pre-recovery state; establish a cutoff and an export/change ledger for later writes, then reconcile and validate that delta into the restored copy before any controlled cutover. Without that documented access and reconciliation, recovery could omit post-point writes. An app-code rollback alone does not restore database data.

## 2. Worker handover

The old published worker does not implement a global lock. Its per-job leases and per-feed advisory locks do not prevent two worker *processes* from initiating different scheduled activity during a Publish overlap.

The proposed **new** worker now requires `GRIDLINE_NEW_WORKER_APPROVED=1` at **every** entry point; the production parent otherwise keeps the API running and does not spawn a new worker. Once approved, the worker acquires a dedicated PostgreSQL session advisory lock **before** starting scheduler, feed, or retention timers. Another new worker fails closed on contention or database error. Connection loss terminates scheduled work; PostgreSQL releases ownership when that session closes. On process shutdown, the worker does **not** unlock early while asynchronous jobs might still be active: process exit closes the owning session. Existing job leases, feed locks, and paid-API controls remain in place.

**Test evidence:** focused API/worker tests passed **24/24**; the real development database admitted one of two independent sessions, transferred ownership after orderly release, and transferred it after terminating the verified development owner session. The simulated old/new test deliberately demonstrates the limitation: with approval unset only the old uncooperative worker runs; with approval set while the old worker is alive **both can run**. The lock cannot fence code already deployed without it. No simultaneous old/new production workers were started, and the development worker workflow remains stopped.

**Handover prerequisite:** independently prove that the old production worker has retired **before** enabling the new one. Do not set the approval flag merely because the new worker acquired its lock. Until activated after an old-worker retirement, the new deployment would serve its API but scheduled refreshes would pause; approve that continuity tradeoff explicitly. In-flight provider requests initiated before a crash may still have remote effects, so session ownership is not an exactly-once guarantee.

## 3. Disabled-by-default red-zone release

Server opt-in is `GRIDLINE_RED_ZONE_ENABLED=1`; consumer build opt-in is `VITE_GRIDLINE_RED_ZONE_ENABLED=1`. Any other value, including absence, is **disabled**. Server authorization remains authoritative even if the web build flag is misconfigured.

- Disabled: the production parent still performs database connectivity/TLS checks and writes its existing release evidence, but does not require red-zone tables; the public red-zone route returns controlled `503` before a fact-table query; PBP derivation skips **before** reading a source file or writing facts; normal non-red-zone ingestion remains available. Web navigation, route, and key-player red-zone calls/cards are hidden.
- Enabled: the existing fail-closed preflight again requires both red-zone tables, six validated constraints, and three valid/ready indexes before either production child starts. The read/write route remains protected. Development-only red-zone backfill commands now need an explicit server flag to derive facts.

**Tests:** exact-value flag, disabled route dispatch, absent-schema startup fixture, non-red-zone UI preservation, and disabled derivation passed. A disposable **development-only schema** was tested first without the red-zone migration (disabled preflight passed; enabled preflight rejected it), then with the **freshly reviewed five additive Publish statements** (enabled preflight passed). The entire transaction was rolled back; this does not demonstrate managed Publish ordering or test a separate production database. The web presentation tests passed **10/10**. API/web type checks and builds passed; development API and web workflows restarted cleanly, and the home preview rendered without red-zone navigation. Local HTTP smoke checks returned `/api/healthz` **200** and disabled red-zone route **503**; these are not a production preview.

## 4. Deployment preview

[Replit documents](https://docs.replit.com/features/data-and-storage/development-and-production#test-changes-with-a-deployment-preview) deployment previews as temporary isolated copies for testing database and app updates. No owner-accessible, verified preview creation control or isolated database identity was established for this project's current VM/multi-artifact release configuration. **No preview was created**, so no preview migration, actual production-run startup, or worker behavior can be claimed as tested.

Default-off worker activation prevents *scheduled* provider calls from this proposed build, but the existing API still has authenticated/manual provider operations, and no preview-wide egress/notification isolation has been demonstrated. Do not open a preview against a database or network environment that could affect production. A valid preview must first show a disposable database identity, fail-closed paid-provider and notification isolation (including manual routes), the exact reviewed schema diff, application readiness, and proof of worker suppression/activation behavior. It must not inherit an enabled worker flag. Preview availability must be confirmed in the owner's publishing UI or by deployment-specific platform guidance before attempting it.

## Remaining release blockers

1. A **currently restorable production point** and a supported isolated restore/export with post-point write reconciliation have not been verified.
2. The published old worker cannot be fenced by new code. The approval flag must remain off until its retirement is independently confirmed; that handover and the refresh pause have not been exercised in production.
3. An isolated platform deployment preview and provider/notification egress isolation are unverified. The development schema transaction is not equivalent.
4. Managed Publish's migration-completion-before-run ordering and automatic retry after a premature startup remain unproven. The interactive Publish diff must be reviewed again at release time. The prior [two-stage assessment](gridline-two-stage-deployment-recovery-assessment.md) still applies: publishing this code would not be a schema-only Stage A.
5. Production has no red-zone schema or Week 2 facts. No production refresh or Phase 6.1 change was authorized. If the red-zone server flag is enabled before the managed schema is ready, its required guard intentionally prevents both new child processes from starting.

**Controlled release is not ready for approval.** Obtain recovery and preview evidence, an owner-approved old-worker retirement/handover plan, platform migration ordering, and a separately reviewed final schema diff before requesting release approval. No production action was taken here.

HOLD