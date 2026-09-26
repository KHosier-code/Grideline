# Future first-line capture: operator HOLD (2026-09-26 UTC)

No production setting, worker, provider, database evidence or published build was changed for this assessment. Read-only observations below are a point-in-time assessment, **not permission to activate collection**. The separate general Data Health review is not repeated here.

## Environment and ownership evidence

| Boundary | Observed | What remains unverified |
| --- | --- | --- |
| Published VM API | Successful public deployment; deployment log at 22:45:36 UTC records database smoke check for build `5bde0e07fd3a-2026-09-26T22:43:10.138Z`, followed by API health and the explicit message that `GRIDLINE_NEW_WORKER_APPROVED` is not exactly `1`. | No direct inspection of the live process environment or connection string. Do not infer old-worker termination from this log. |
| Managed production read replica | `pg_is_in_recovery()=true`, database `neondb`; `release_security_evidence` contains that **same build ID and 22:45:36.180 UTC check time**. This strongly correlates the published API startup write with the inspected managed database, beyond merely matching its name. | The live API's physical connection and any external binding are not directly attested. Have the operator verify runtime identity before writes; the replica alone cannot fence another deployment. |
| Older production worker | Earlier deployment logs and persisted scheduler/feed runs document an older worker that did not take the new global advisory lock. The latest keyed durable schedule success in the inspected replica began 02:18 UTC September 26; an unkeyed sync began 22:48 UTC. At 22:56 UTC, there were no active scheduler row leases. | **Whether any old worker is alive now, and which process caused the 22:48 sync, is unknown.** No process inventory/termination receipt or lock-holder inspection from the actual deployment was available. An empty lease is not proof of retirement. |
| Development worker | Configured `Gridline data worker` workflow is `not_started`. Development is separate from the published VM. | Its state cannot be used to establish production ownership. |

The new worker takes a session-level global advisory lock before starting jobs, but an older binary does not participate in that lock. A second new worker will fail closed; an older one will not. The published API currently serves requests without spawning the gated new worker. The old-worker continuity and cause of its stoppage are unverified.

## Request-bound pick evidence (production replica, ~22:45–22:56 UTC)

- Enabled overdue scheduler jobs: **37**, including `odds-adaptive` due **14:00 UTC September 26**, schedule, feature repair, personnel context, one prediction slot, 13 confidence captures and 17 `prediction-canonical` jobs. The old canonical rows are particularly important to review before any activation; do not assume a stale job will be harmless. There were no active scheduler row locks at inspection. Re-inventory immediately before a transition.
- Latest paid request is **id 37**, admitted/running since **00:14:15 UTC September 25**, without final quota metadata. Its sync-run record was later marked failed as a stopped-process recovery, but the request ledger remains `running`. The preceding successful scheduled request (id 36, 00:08 UTC September 25) reported **3 credits used, 380 remaining then**, HTTP 200, 384 records. Neither is a current balance or authorization to spend. A new request is blocked by unresolved prior admission in the current code; do not silently reclassify or delete that ledger entry. Determine its upstream outcome and use an explicitly approved, separately reviewed resolution before another paid request.
- There are **15 future Week 3 games** (September 27–29), **16 Week 4 games**, and **15 Week 5 games** in the inspected schedule. All 15 Week 3 and all 16 Week 4 games already have persisted quotes (first stored captures **September 17 18:27:46 UTC** and **September 24 20:36:08 UTC** respectively); Week 5 has none in the inspected aggregate. Every inspected upcoming slate has **zero `initial_line_picks` decisions**, and `initial_weekly_picks` is empty. The public `GET /api/consumer/dashboard` returns `pick: null`, reason **“Waiting for first verified lines for the upcoming slate.”** That reason reflects *missing persisted decisions*, not proof that the old quotes are eligible.
- Production promotions exist for spread, moneyline and totals (`phase6-1` families). Week 3 has 30 paired `pregame-v3` feature rows and Week 4 has 32; their recorded cutoffs/generated times precede kickoff. This establishes **candidate rows only**: full finite 27-value vectors, each source's point-in-time cutoff, artifact integrity and valid predictions at a *future request time* have not been demonstrated by these aggregate queries. A complete market from one sportsbook and a successful matched request are also necessary. Missing inputs yield `missing_input`; missing/invalid promotion yields `invalid_model`; incomplete sides yield `incomplete_market`; an already older quote yields `legacy_unattributed`; an event with no valid lines yields `no_line`. These are terminal first-observation decisions, not backfill candidates.
- A new successful capture for Week 3 or Week 4 must **not** label prior quotes as initial. Current capture code checks for older game odds before inserting a request-bound decision; when such odds exist it records `legacy_unattributed`, regardless of current model readiness. A paid request solely to promise a current-week winner is therefore unjustified. A future slate with no previous quotes can only lock if its *actual first* successful matched observation and cutoff-safe inputs qualify. The UI must keep the saved no-pick blocker until a verified weekly lock exists.

## Isolated startup and capture rehearsal

`bash scripts/rehearse-worker.sh` created a fresh local PostgreSQL cluster/database named `gridline_rehearsal` on loopback, with a per-run marker and system ID attested **before** loading the worker's database/provider modules. It built the current worker, seeded synthetic representative scheduler rows from the earlier development inventory, and ran the actual startup preparation/recovery SQL. Network sockets outside that local port, `fetch`, and intervals were blocked before imports. The cluster was deleted on exit. Detailed sanitized itemization: [gridline-worker-rehearsal-results.json](gridline-worker-rehearsal-results.json). This is **not a copy of production**, and its fixed 02:09:54 UTC clock and synthetic game IDs do not forecast today's exact production queue.

| Representative overdue fixture | Startup disposition |
| --- | --- |
| Adaptive odds (1), schedule (1), feature repair (1), personnel context (1), injury weekly/dynamic (10), prediction weekly/grade (6), NFLverse (1), Sleeper (1), challenger (1) | Old occurrence skipped, future occurrence rearmed; these **can run later** after normal ticks. Odds can spend credits when permitted; free feeds/models can contact sources/write data. |
| Confidence (49), kickoff injury windows (3), expired freeze (17) | Skipped and disabled, no late capture/lock. A future kickoff still creates/rearms future one-shots. |
| Newly reconciled future jobs | Future canonical prediction, confidence offsets and Sunday injury window; none executed in rehearsal. |

There were **92 skipped overdue occurrences, zero provider contacts, zero scheduled executions, zero retention deletions, zero writes to a live database**. The independent feed scheduler and both retention timers are deliberately **not started** in rehearsal; that proves isolation, **not** that a real activation would suppress them. Normal `worker.ts` starts feed scheduler (which immediately checks ESPN injury, NFLverse and NWS weather slots) and both Usage Lab and player-recovery receipt retention (each runs its first cleanup immediately), then their timers. Review their slots, locks, deletion scope and schema before approval. Running the startup test again is not equivalent to an authorized full live tick.

A second disposable fixture inserted a *synthetic successful scheduled request* and matching saved quotes without fetching a provider. It verified: no prior quote + complete same-book moneyline/spread + promoted immutable artifacts and cutoff-safe features → request-bound `locked` decision and saved weekly selection; an older quote → `legacy_unattributed`; empty first event → `no_line`; retry/later quote cannot alter either terminal decision. No historical odds or initial decision was rewritten. The synthetic lock is **not** a production pick or a claim about the current slate. API typecheck and `git diff --check` passed.

## Controlled operator handoff — do not enable yet

1. Inventory **every** production worker process/deployment, its binary/build and scheduler/feed activity from the actual runtime; confirm and **stop all older lock-unaware workers**. Obtain termination/exit evidence and check no in-flight calls remain. Pause explicitly rather than overlap old and new. The new advisory lock cannot protect against an old process.
2. Independently attest the target writable production database in the actual runtime against the correlated release evidence without exposing its URL or credentials. Check the exact reviewed Publish schema/migrations (including feature-flag-dependent gates) and release readiness before starting anything. A schema mismatch is a stop condition, not a reason to run startup DDL.
3. Immediately before activation, read-only re-inventory scheduler due/locks, `scheduled:*` feed attempts, both retention scopes, game kickoffs, historical quote/decision coverage, promotion and feature readiness, and **request 37's unresolved paid admission**. Decide whether the expected future odds window is worth a new call; determine its real upstream state and current account quota via an operator-approved channel. Do not infer the balance from id 36 or bypass request admission automatically. Explicitly approve any provider contact and a finite paid-call/credit budget, including actual-vs-estimated per-call cost and the adaptive cadence.
4. Only after old-worker termination, identity/schema checks, queue review and a named operator's authorization, set `GRIDLINE_NEW_WORKER_APPROVED=1` for the intended production launcher and start **one** new worker. Do not start the development workflow as a surrogate. Monitor ownership, API health and the first startup reconciliation before any normal tick. The deployment's approval setting is not changed by this report.
5. **Stop the new worker and revoke approval** on duplicate ownership/old-worker activity, unexpected catch-up or repeated near-term jobs, mismatched database/schema, provider errors, an unresolved request admitted again, or quota/use above the approved budget. Stopping the worker prevents new work but does not undo completed calls or immutable rows; do **not** manually delete/overwrite odds or initial decisions. Preserve ledger/log evidence, investigate, and only retry with a fresh explicit approval.

### Read-only post-start verification

Confirm a single new worker's ownership and sustained process health from its runtime logs; confirm the old process stays terminated. Correlate the worker's database identity with the API release evidence. Compare before/after `scheduler_jobs` (including odds and freeze), `data_sync_runs`, independent `scheduled:*` runs and both retention logs. Check each newly admitted `odds_api_requests` row: intent, original `requested_at`, terminal success/failure, provider cost/remaining and matched `odds_event_audits`; do not count a `running` row as success. Join `initial_line_picks.request_id` to that successful request, inspect game kickoff, first saved quote time, terminal status and the three promoted model/input evidence fields. Check `initial_weekly_picks` once per season/week and `GET /api/consumer/dashboard` for a verified saved selection or the unchanged no-pick reason. If the first successful observation is legacy, incomplete or input-ineligible, record the limitation and target a **later, genuinely first-observed slate** rather than manufacturing a current winner.

Suggested read-only spot checks on the **attested target**, before and after activation (use a replica for inspection only; do not mistake it for runtime attestation):

```sql
SELECT job_key, kind, enabled, next_run_at, last_run_at, last_status, lock_until
FROM scheduler_jobs
WHERE kind IN ('odds-adaptive', 'prediction-freeze', 'prediction-canonical')
ORDER BY next_run_at NULLS LAST LIMIT 100;

SELECT id, intent_key, requested_at, status, credits_used, credits_remaining,
       metadata->>'jobKey' AS job_key
FROM odds_api_requests ORDER BY requested_at DESC LIMIT 20;

SELECT g.game_id, g.season, g.week, g.kickoff_time,
       (SELECT min(o.captured_at) FROM sportsbook_odds o WHERE o.game_id=g.game_id) AS first_quote,
       i.request_id, r.status AS request_status, i.requested_at, i.observed_at,
       i.status AS initial_status, i.reason, i.winner_team_id,
       i.vector_schema_fingerprint, i.input_source_evidence IS NOT NULL AS has_input_evidence
FROM games g
LEFT JOIN initial_line_picks i ON i.game_id=g.game_id
LEFT JOIN odds_api_requests r ON r.id=i.request_id
WHERE g.kickoff_time > now() AND g.game_status !~* 'final|completed|postponed|cancel'
ORDER BY g.kickoff_time LIMIT 100;

SELECT season, week, game_id, selected_at
FROM initial_weekly_picks ORDER BY selected_at DESC LIMIT 20;
```

**Decision: HOLD.** Old-worker termination, direct writable binding attestation, request 37 resolution, current quota, reviewed live queue/schema and operator approval are still missing.