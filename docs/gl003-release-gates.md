# GL-003 release gates — not authorized to publish

Candidate must not be published until the database guard path and administrator
approval are both resolved. The current published code is GL-002. This document
is an operator review plan, **not** a production migration script.

## Schema authority and the exact guard migration

The original guard definitions are in
`lib/db/migrations/0033_immutable_canonical_prediction.sql`. The exact
additive install unit for schemas missing the custom triggers is
`lib/db/migrations/0036_reject_direct_official_inserts.sql`:
`reject_canonical_prediction_mutation()` with
`canonical_prediction_immutable BEFORE INSERT OR UPDATE OR DELETE ON prediction_snapshots`,
and `reject_prediction_grade_mutation()` with
`prediction_grade_immutable BEFORE UPDATE OR DELETE ON prediction_grades`.
Migration 0036 also rejects direct official inserts and an initial official
freeze at/after the authoritative kickoff, with a missing/late T−30 cutoff, or with a model
timestamp after cutoff. Migration 0033 defines the one-official-per-game unique
index (lines 4–6), `evaluation_cutoff_at` (lines 8–9), and grade constraints
(lines 11–20).
Reapplying the *whole* migration to an existing schema is not safe: its
`ADD CONSTRAINT` statements are not idempotent. An approved
custom-SQL-capable migration mechanism would apply **0036 only** transactionally
after the checks below. The trigger functions
do not change existing rows and block direct official inserts, future
updates/deletes to official snapshots and any grade, plus invalid initial
official freezes.
Migrations 0034 and 0035 are recorded development history: 0035 repaired
development schemas where the runner incorrectly recorded 0034 as a baseline
by checking trigger names rather than function behavior. Migration 0036 is
the complete and current standalone guard installation for a missing-trigger
schema; its `-- @execute-once` marker prevents that false baseline.

**Current platform blocker:** Replit Publish's development-to-production schema
diff is empty even though these two triggers are present in development and
missing in managed production. The project migration runner is development-only.
Consequently, merely committing this SQL and clicking Publish does **not**
install these functions/triggers; do not use a deploy/build hook, application
startup DDL, an agent-initiated direct production DDL call, or the development
runner with production credentials. Obtain a supported, operator-reviewed
custom SQL installation path from the platform before approving GL-003.
An additive schema diff cannot be represented by the current table/column/index
diff for these custom objects.

## Read-only preflight (run against the intended production database)

```sql
SELECT count(*) AS snapshots, count(*) FILTER (WHERE official_final_prediction) AS flagged_official,
       count(*) FILTER (WHERE official_final_prediction AND
         (frozen_at IS NULL OR kickoff_time IS NULL OR frozen_at >= kickoff_time
          OR evaluation_cutoff_at IS NULL)) AS legacy_invalid
FROM prediction_snapshots;
SELECT count(*) AS grades FROM prediction_grades;
SELECT game_id,count(*) FROM prediction_snapshots WHERE official_final_prediction
GROUP BY game_id HAVING count(*) > 1;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
  AND tablename='prediction_snapshots'
  AND indexname='prediction_snapshots_one_official_per_game';
SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE c.relname IN ('prediction_snapshots','prediction_grades')
  AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
```

Preconditions: the unique index exists with the `official_final_prediction =
true` predicate; no game has two flagged official rows; identify and retain
invalid legacy rows rather than rewriting them. Confirm the operator's
backup/checkpoint, the target database identity, and the Publish diff. The
production guard installation is additive to existing data, not a backfill.
After an authorized platform-supported installation, read back *enabled*
`canonical_prediction_immutable` and `prediction_grade_immutable` triggers and
verify their definitions and referenced functions, including `INSERT` on the
former. **Do not perform a
production INSERT/UPDATE/DELETE as a smoke test.**

## Compatibility and rollback

GL-002 only changes a pending snapshot to official once, then skips rows
already marked official; its grading inserts rather than updates grade rows.
Those normal on-time operations are compatible with these triggers. GL-002's
old freeze path can still *attempt* initial late or post-cutoff freezes;
the 0036 trigger rejects those attempts rather than creating invalid official
rows. Such a failed occurrence may leave the GL-002 worker retrying. Disable
official creation/worker before rollback, verify it is stopped, and assess
existing records without editing them; GL-002 cannot be assumed to run all
freeze jobs successfully under the tightened guard. A code checkpoint
and republish do not remove production triggers or restore database rows;
keep the additive guards in place. Any deliberate removal would need a separate
authorized and reviewed database change.

## Evidence policy and observed opportunity

The paid odds worker schedules a 12-minute cadence from 6h to 1h before
kickoff and 5-minute cadence inside 1h, subject to quota and provider success.
The older weekly slots and final 45-minute jobs do not guarantee a paired
observation in the exact T−45 to T−30 window. The odds history is change-only,
so this measures *provable persisted evidence*, not provider availability.
For 33 games kicked off September 1–25, 2026, stored data had 0/33 complete
DK+FD paired spread/total/moneyline sets within 15 minutes of T−30; 32/33 had
no paired component. One game had complete DK+FD total and moneyline pairs
but not spread. Eighteen of 33 had at least one pre-cutoff model snapshot,
an upper bound on eligible projections before full input validation. Thus the
old all-market official rate is 0/33; the revised projection rate is at most
18/33 on this sample, not a forecast guarantee. Individual market evidence
would have covered total 1/33, moneyline 1/33, spread 0/33.