# Gridline final Publish safety gate

**Decision: HOLD — EXTERNAL DEPLOYMENT VERIFICATION REQUIRED.** Scoped Gate 4 review on 2026-09-25 (America/Chicago; UTC test logs dated September 26). Gates 1–3, 5–10 are not being re-audited; the Week 2 recovery and arithmetic evidence remain in `reports/gridline-red-zone-release-unblock.md`. No Publish, production migration/write, production worker start, or provider synchronization was performed.

## 1. Deployment sequence: what is and is not verified

This is a **Reserved VM** deployment per deployment metadata and `.replit` (`deploymentTarget = "vm"`). The API artifact's production **build** runs `pnpm --filter @workspace/api-server run build`; its production **run** is `node --enable-source-maps artifacts/api-server/dist/production.mjs`, with `PORT=8080`, `NODE_ENV=production` and a configured `/api/healthz` startup check. The `.replit` post-build command only prunes the pnpm store. The development-only `Gridline data worker` workflow is **not** a separate production run target; the production parent owns both child processes. Neither build nor run contains a migration command.

The project's database is managed by Replit's Publish flow. A fresh, **read-only** Publish diff inspection returned exactly **five additive statements**: `CREATE TABLE red_zone_player_game_facts`, `CREATE TABLE red_zone_team_game_facts`, and three dependent `CREATE INDEX` statements. Primary keys and the six zone/nonnegative-count checks are inside the two table statements. The diff reported **no structural data loss, non-backwards-compatible change, destructive object removal, or warning**. This is a snapshot, not approval of a future interactive Publish diff.

**Enforced application startup, conditional on the schema being present:**

1. The production parent performs a database smoke query and read-only checks for **two tables, six validated constraints and three valid/ready indexes** in the current schema. Failure exits nonzero **without spawning the API or worker**.
2. The parent records its existing release evidence and logs a sanitized successful database check.
3. The parent starts the API and waits for **HTTP 200 at its local `/api/healthz`** (bounded to 15 seconds). API exit, invalid port, or failure to become healthy stops startup; the worker is **not** launched. The API readiness event is logged before worker launch.
4. Only then does the parent spawn the worker. Production provider scheduling is still owned by that worker, not the API.

**Not verified:** Replit's managed **schema-diff completion before this artifact's run command begins**. The [official development/production database page](https://docs.replit.com/features/data-and-storage/development-and-production) says development schema changes are applied to production *at publishing* and recommends a deployment preview, but does not explicitly specify their timing relative to the artifact's run command. Search-result summaries asserted a stronger guarantee; the cited page did not substantiate it. The project configuration specifies build and run order but no explicit platform migration dependency. Neither an owner-authorized Publish nor a platform deployment preview was performed for this task. If Replit starts the parent too early, the schema gate fails closed; the available evidence does **not** establish whether the platform retries that failed parent after completing the migration.

## 2. Isolated migration-and-start test

The current five SQL statements were captured from the read-only diff into an ignored local fixture, `.cache/gridline-approved-schema-diff.json` (SHA-256 `d0e76114bad7d0f5a9db847696d55e079d5569faa308722b974ba5f75ea10cac`). The opt-in test rejects any non-development or deployment environment and verifies the local development database identity (`heliumdb`/`postgres`, primary, local proxy) **before** issuing DDL. It also rejects missing, reordered, destructive, or schema-qualified statements. Run it against a freshly reviewed diff with:

```sh
GRIDLINE_APPROVED_SCHEMA_DIFF="$PWD/.cache/gridline-approved-schema-diff.json" \
  pnpm --filter @workspace/api-server run test:production-schema-order:dev
```

The test opens **one development-only transaction**, creates a uniquely named disposable schema, sets the transaction's search path there, and rolls the transaction back. It uses the current Publish diff **unchanged** and calls the same production schema-readiness function used by the parent. Results:

| Isolated state | Schema check | API callback | Worker callback |
| --- | --- | --- | --- |
| No red-zone schema | Fails | Not called | Not called |
| Two tables and two of three indexes; deliberately failed final index creation rolled back to a savepoint | Fails on missing index | Not called | Not called |
| All five approved statements applied | Passes | Called first | Called second |

**1/1** isolated test passed. The disposable schema was absent after rollback, and counts in the existing development `games` and player-fact tables were unchanged. This is a **deployment-equivalent schema and startup-order harness**, not a real Replit Publish, not a clone of the full application database, and not a launch of the actual API or worker against the disposable schema. The API's ordinary local `/api/healthz` returned HTTP 200 separately. Unit tests cover missing/invalid tables, constraints and indexes; asynchronous API readiness; unhealthy/exited API suppression of worker startup; and allow-listed startup alerts. **13/13** focused production smoke/alert tests passed, and API/shared-library TypeScript checks and the API build passed.

## 3. Supported configuration and remaining risk

The application now has an enforceable **read-only** startup dependency and API-health-before-worker ordering. No production configuration or schema was changed. For this managed PostgreSQL database, the supported production schema writer is **Replit Publish's reviewed schema diff**. The database migration guidance explicitly rules out a custom production migration script, deploy-build `db:push`, or startup-time DDL; none was added. Therefore an app-owned “migration-and-start” command is **not a supported alternative** for this project. A separate migration step is only an option if Replit provides and confirms an owner-controlled, supported schema-only Publish or equivalent mechanism; do not invent a direct production SQL or build-hook workaround.

The outstanding risk is **availability, not an unsafe worker write**: if Publish starts the parent before applying its managed diff and does not retry after the diff, the new deployment will remain unhealthy even though the guard prevents both child processes from starting. The 15-second API health bound also needs confirmation under the real deployment's startup conditions. No actual migration, API child, or worker startup was exercised in production, so the final runtime order and post-publish provider behavior remain unverified.

## 4. Exact owner actions and conditional deployment procedure

1. **Before approval:** Obtain deployment-specific, authoritative evidence that the managed Publish schema diff completes **before** the API artifact's production run command executes (platform documentation explicitly stating this, written Replit confirmation, or an owner-authorized isolated platform preview showing migration and process timestamps). An isolated preview must not modify the live production database. If no such evidence or supported preview is available, **keep HOLD**; do not substitute a custom migration script.
2. Re-open the **interactive Publish diff** and confirm exactly the approved additive two-table/three-index changes, including six checks and PKs, with no drops/truncations, destructive rename default, development-data overwrite, or unrelated schema changes. Stop and investigate any deviation. Obtain explicit owner approval before clicking Publish.
3. **Only after steps 1–2:** Publish using the existing API artifact build/run configuration. Do not launch the worker separately. If the managed migration or read-only parent preflight fails, stop; do not bypass the gate or run direct production DDL.
4. Observe the rollout in this order: managed migration completion; parent database/schema preflight success; API startup and **local health readiness**; worker launch. A successful preflight and health log without separate platform migration evidence is not proof of step 1.

### Post-Publish verification checklist (not performed here)

- Confirm the deployed build and production database identity through deployment evidence; `SELECT 1` and full startup verification pass. Confirm **two tables, six validated constraints and three valid/ready indexes** in the live production schema, with no unrelated drops.
- Check `/api/healthz` and the red-zone consumer read path; confirm an unavailable feed is not represented as zero. Do **not** assume the development-only Week 2 facts were copied to production.
- Verify logs show `Production database smoke check passed`, then `production_api_health_ready`, then worker startup. Confirm no `production_database_startup_gate_failed` or `production_api_startup_gate_failed` events.
- Inspect only the worker's **approved scheduled** provider runs and failure records. Its first scheduler evaluation occurs on startup; make sure no unexpected catch-up or paid-provider activity occurred.
- Recheck the preserved official/frozen Phase 6.1 prediction and model evidence against the previous release baseline. Any discrepancy or failed migration keeps production **unverified** and requires investigation before declaring release complete.

**HOLD — EXTERNAL DEPLOYMENT VERIFICATION REQUIRED**