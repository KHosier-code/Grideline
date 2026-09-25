# GL-003 production guard installation review — execution blocked

Published production remains GL-002. Candidate
`af67d3c72869be1477b46e64b3ed5bb8a4c21024` must remain unpublished.
This is a review package, not authorization to run SQL. **No production DDL
or test writes have been performed.** Do not publish GL-003 to install guards.

## Is Production Database → My Data → SQL runner a supported path?

[Replit's My Data documentation](https://docs.replit.com/features/data-and-storage/work-with-your-data)
documents selecting the production database, turning on **Edit**, and using
the **SQL runner** for SQL commands. It does **not explicitly confirm**
`CREATE FUNCTION ... LANGUAGE plpgsql`, `CREATE TRIGGER`, dollar-quoted function
bodies, or a multi-statement transaction in that production UI. Replit's
documented Publish schema diff is empty for this change: it does not transfer
the custom triggers. The agent's production SQL connection is a read-only
replica and cannot establish what the operator's UI writer accepts.

**Decision: SQL-runner suitability is unconfirmed. Do not submit the block
below through that UI yet.** First obtain an explicit Replit confirmation for
these exact statement classes, transaction behavior, role and maintenance
controls; otherwise ask Support for the approved operator-run installation
path (request template below). Generic permission flags on the read replica
do not constitute that confirmation. No application startup, deploy hook, or
development migration runner may apply production DDL.

## Scope and exact SQL for authorized review

The standalone source is `lib/db/migrations/0036_reject_direct_official_inserts.sql`.
Only its two functions and two triggers are needed. Do **not** replay migration
0033: its existing `ADD CONSTRAINT` statements are not idempotent. Migrations
0034–0035 are development history superseded by 0036. The transaction and
short lock timeout below are operator safeguards; the function bodies and
trigger definitions match 0036. **Hold this SQL until the supported execution
surface and transaction support are confirmed and a separate administrator
authorizes the maintenance operation.**

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION reject_canonical_prediction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authoritative_kickoff timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.official_final_prediction THEN
      RAISE EXCEPTION 'official prediction snapshots are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.official_final_prediction THEN
      RAISE EXCEPTION 'official prediction requires a validated pending-to-official freeze';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.official_final_prediction AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'official prediction snapshots are immutable';
  END IF;
  IF NEW.official_final_prediction AND NOT OLD.official_final_prediction THEN
    SELECT kickoff_time INTO authoritative_kickoff FROM games
      WHERE game_id = NEW.game_id;
    IF authoritative_kickoff IS NULL
      OR NEW.kickoff_time IS DISTINCT FROM authoritative_kickoff
      OR NEW.frozen_at IS NULL OR NEW.frozen_at >= authoritative_kickoff
      OR clock_timestamp() >= authoritative_kickoff
      OR NEW.evaluation_cutoff_at IS NULL
      OR NEW.evaluation_cutoff_at > authoritative_kickoff - interval '30 minutes'
      OR NEW.prediction_timestamp > NEW.evaluation_cutoff_at THEN
      RAISE EXCEPTION 'official prediction requires a pre-kickoff freeze and a model snapshot at or before the 30-minute cutoff';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_prediction_immutable ON prediction_snapshots;
CREATE TRIGGER canonical_prediction_immutable
BEFORE INSERT OR UPDATE OR DELETE ON prediction_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_canonical_prediction_mutation();

CREATE OR REPLACE FUNCTION reject_prediction_grade_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prediction grades are immutable';
END;
$$;

DROP TRIGGER IF EXISTS prediction_grade_immutable ON prediction_grades;
CREATE TRIGGER prediction_grade_immutable
BEFORE UPDATE OR DELETE ON prediction_grades
FOR EACH ROW EXECUTE FUNCTION reject_prediction_grade_mutation();

COMMIT;
```

The operator must verify the SQL runner's `current_schema()` is `public` and
that its session search path resolves `games` to `public.games` before using
the exact disposable-database-tested SQL. `DROP TRIGGER IF EXISTS` is permitted
**only after preflight confirms no existing custom guards
would be replaced**. If unexpected functions/triggers exist, stop and reconcile
their definitions rather than overwriting them.

## Read-only production preflight

Run these SELECT statements before maintenance and again immediately before
the authorized transaction. The agent's production query surface is a **read
replica**; the operator must also run the identity/permission checks against
the actual **production SQL runner connection** after the UI path is confirmed.
Read-replica permission flags do not establish runner write capability.

```sql
SELECT current_database(), current_user, current_schema(),
       current_setting('search_path') AS search_path,
       pg_is_in_recovery() AS is_read_replica,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
       has_table_privilege(current_user, 'public.prediction_snapshots', 'TRIGGER')
         AS can_trigger_snapshots,
       has_table_privilege(current_user, 'public.prediction_grades', 'TRIGGER')
         AS can_trigger_grades,
       has_language_privilege(current_user, 'plpgsql', 'USAGE') AS can_use_plpgsql;
SELECT n.nspname, p.proname, l.lanname, pg_get_userbyid(p.proowner) AS owner,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname IN ('reject_canonical_prediction_mutation',
                    'reject_prediction_grade_mutation')
ORDER BY p.proname;
SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition,
       t.tgfoid::regprocedure AS function_name
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('prediction_snapshots', 'prediction_grades')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
SELECT count(*) AS snapshots,
       count(*) FILTER (WHERE official_final_prediction) AS flagged_official,
       count(*) FILTER (WHERE official_final_prediction
         AND (frozen_at IS NULL OR kickoff_time IS NULL
              OR frozen_at >= kickoff_time OR evaluation_cutoff_at IS NULL))
         AS legacy_invalid
FROM public.prediction_snapshots;
SELECT count(*) AS grades FROM public.prediction_grades;
SELECT game_id, count(*) FROM public.prediction_snapshots
WHERE official_final_prediction
GROUP BY game_id HAVING count(*) > 1;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'prediction_snapshots'
  AND indexname = 'prediction_snapshots_one_official_per_game';
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'prediction_grades'
  AND indexname = 'prediction_grades_prediction_id_key';
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.prediction_grades'::regclass
  AND conname IN ('prediction_grades_prediction_fk',
                  'prediction_grades_scores_nonnegative_check')
ORDER BY conname;
```

Observed on the production read replica on September 25, 2026: 229 snapshots,
one flagged official row (a legacy invalid row), zero grades, zero duplicate
official games, the correct unique partial index, and **no matching custom
functions or triggers**. The grade prediction-ID unique index and both grade
FK/nonnegative-score constraints are also present. The replica reports
`pg_is_in_recovery() = true` and
privilege flags `true`, which cannot prove the SQL runner's writer permissions.
Before execution, verify no unexpected function/trigger exists, the index
predicate is `official_final_prediction = true`, the grade unique index and
validated constraints are present, the catalog/count results
are recorded, and the runner identifies the intended production database with
`current_schema() = 'public'` and a non-replica writer connection. A changed
baseline requires review, not a silent overwrite or data repair. The legacy
row is intentionally retained and not made verified by installing guards.

## Operator maintenance sequence — conditional, not approved

1. Get Replit's written confirmation that the **production** My Data SQL
   runner accepts these PL/pgSQL, trigger, and one-transaction statements with
   an authorized writer, or get a different supported operator path. Confirm
   how to pause/resume the **published GL-002 worker** (not the development
   workflow) and obtain a production backup/checkpoint with a tested recovery
   procedure. Seek a separate administrator approval for this maintenance.
2. Choose a quiet kickoff window. Pausing across T−30 can permanently forfeit
   a game's official opportunity; accept or reschedule that risk first. Pause
   official-freeze and grading jobs in the published worker, confirm they are
   stopped and not auto-restarting. Keep GL-002 code published.
3. Re-run the read-only preflight on the intended production writer. Require
   the expected `public` search path and sufficient CREATE/TRIGGER/plpgsql
   privileges. If any custom guard already exists, stop for definition review.
4. Only after the preceding gates, an authorized operator may submit the
   **entire** SQL block above as **one transaction** in the confirmed surface.
   Never paste pieces into independently committed SQL-runner calls. The lock
   timeout avoids waiting indefinitely on live tables; on any error, verify
   rollback before considering a retry.
5. Keep the worker paused while performing the read-only post-install checks
   below on the writer, then on the read replica after it catches up. Compare
   row counts to the immediately preceding baseline; expect no row changes.
   Resume the GL-002 worker only after the operator accepts its changed
   failure behavior and can monitor repeated freeze errors. GL-003 remains
   unpublished.

## Read-only post-install verification

Run the function and trigger catalog SELECTs from preflight again. Require
exactly two `public` functions with `RETURNS trigger` and `LANGUAGE plpgsql`,
and exactly these two non-internal, enabled triggers:

- `prediction_snapshots.canonical_prediction_immutable`: `tgenabled = 'O'`,
  `BEFORE INSERT OR UPDATE OR DELETE`, invokes
  `public.reject_canonical_prediction_mutation()`.
- `prediction_grades.prediction_grade_immutable`: `tgenabled = 'O'`,
  `BEFORE UPDATE OR DELETE`, invokes
  `public.reject_prediction_grade_mutation()`.

Read the **full** `pg_get_functiondef` bodies: snapshot function rejects a
direct official INSERT, updates/deletes of an official row, and transitions
after kickoff or with a missing/late cutoff or model timestamp; grade function
raises on updates/deletes. Presence of trigger names alone is insufficient.
For the current development install, `md5(pg_get_functiondef(...))` is
`f67a20d555559bc602a83a8d77599d67` (snapshot) and
`8adbd068dde4603b495f076e6a90244f` (grade); use these as comparison aids,
not a substitute for reviewing the definitions if PostgreSQL formatting
differs. Re-run the counts/duplicate/index checks from preflight. **No
production INSERT/UPDATE/DELETE smoke test.** Record the operator, time,
target, confirmation, pre/post results, and backup reference without
recording credentials.

## GL-002 compatibility and recovery

GL-002 only changes a pending snapshot to official once, then skips rows
already marked official; its grading inserts rather than updates grade rows.
Those normal on-time operations are compatible with these triggers. GL-002's
old freeze path can still *attempt* initial late or post-cutoff freezes;
the 0036 trigger rejects those attempts rather than creating invalid official
rows. Such a failed occurrence can make the GL-002 worker retry/log errors;
it must not be mistaken for a successful freeze. The disposable
production-equivalent database verified an on-time GL-002-style transition and
grade insert, a rejected late transition, duplicate-official rejection,
official/grade immutability, and append-only correction (20 focused tests
passed). It did **not** run the deployed GL-002 worker end to end.

If installation fails **before COMMIT**, the transaction must roll back
completely: use read-only catalog queries to establish the preflight state.
If the UI cannot guarantee atomic transaction semantics, do not start.
If the post-commit definitions, counts, or worker behavior are unexpected,
keep the worker paused, preserve production evidence, collect read-only logs
and catalogs, and ask the operator/Replit Support to diagnose. Prefer leaving
correctly installed additive guards in place while fixing the operational
problem; do not casually drop triggers and expose official rows. An authorized
restore of the pre-install database state is a last resort requiring impact
review because it may also erase legitimate intervening data. A code rollback
or republish of GL-002 does **not** remove database triggers. No automated
production rollback script or application DDL is provided.

## Request to Replit Support if the runner cannot be confirmed

> We use Replit-managed production PostgreSQL. Replit Publish reports no
> development-to-production schema diff for custom PL/pgSQL functions/triggers.
> Production has the existing `prediction_snapshots`/`prediction_grades` tables,
> partial unique official index, and required columns/constraints, but no
> non-internal guards on these two tables and no matching guard functions.
> We need an **operator-reviewed, one-time, transactional, additive** install
> of two `CREATE OR REPLACE FUNCTION ... RETURNS trigger LANGUAGE plpgsql`
> definitions and two `CREATE TRIGGER` statements, without touching row data.
> Does **Production Database → My Data → Edit → SQL runner** permit an
> administrator to execute these exact PL/pgSQL and trigger statements
> atomically, including a dollar-quoted function body and `BEGIN`/`COMMIT`?
> Which role/permissions, backup/checkpoint, lock-timeout, and published-worker
> pause controls apply? If the runner does not support this, what supported
> operator-controlled mechanism can review and install the attached
> `lib/db/migrations/0036_reject_direct_official_inserts.sql` definitions
> transactionally? Please do **not** execute anything without our explicit
> administrator authorization and an agreed maintenance window. We will
> verify function definitions, enabled trigger state, and row counts with
> read-only queries afterward. We will not use an application startup/deploy
> migration or write test rows to production.

Do not ask for GL-003 approval while the production install method or guard
state is unresolved. After an authorized installation, recheck the GL-002
worker and baseline counts, then prepare a **new**, separate GL-003 go/no-go
decision and administrator approval request. Never conflate guard maintenance
approval with candidate publication approval.

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