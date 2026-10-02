# Gridline production go-live checklist

This checklist is the operator gate for moving Gridline from development to
private production. Run the reproducible, read-only evidence report first:

```sh
pnpm --filter @workspace/scripts report:production-readiness
pnpm --filter @workspace/scripts report:production-readiness -- --format=markdown
# Optional: target a specific matchup; otherwise the nearest upcoming game is used.
pnpm --filter @workspace/scripts report:production-readiness -- --away=DET --home=BUF --format=markdown
```

The report queries the development database with `SELECT` statements only. It
does not refresh feeds, generate projections, or repair rows. `pending` means that a real game-cycle event
has not happened (or has no persisted evidence); it is not a pass. Do not
replace a pending or warning result with an assumption.

## Release gate

- [ ] Review the report's 12 production-cycle checks and attach its JSON and
  Markdown output to the release record.
- [ ] Confirm the report names the target kickoff and normalized state, authoritative
  entering records (all 32 teams and discrepancies), current DK/FD quote ages,
  adaptive worker lease/cadence/skip state, quota affordability, QB-model
  projection coverage, final-pre-kickoff evidence, and final results.
- [ ] Resolve every warning and document every pending real-time step.
- [ ] Obtain an administrator approval for the deployment, model state,
  database checkpoint, and rollback plan.
- [ ] Do not call the system **fully unattended ready** until the worker,
  production database, authentication, secrets, scheduled jobs, logging,
  backups, and one real completed game cycle have been verified.

## Application deployment

- [ ] Publish the reviewed application build through the Replit Publish flow;
  do not use a development preview as the production URL.
- [ ] Confirm `release_security_evidence` contains one row for the published
  build before the API and worker start. The row records the build identifier,
  check timestamp, `SELECT 1` result, and verify-full policy outcome only. A
  missing/disabled production TLS mode, PostgreSQL TLS compatibility warning,
  connectivity error, or evidence-write failure blocks startup and creates no
  success row. Evidence never contains a database URL, hostname, username, or
  credentials.
- [ ] Confirm the production URL, HTTPS, health endpoint, API routing, static
  assets, and an authenticated read-only page load.
- [ ] Confirm the UI displays data-health and model/prediction safety states;
  it must not present missing data as a recommendation or a successful sync.
- [ ] Record the build/version, deployment time, operator, and rollback
  destination.

## Persistent VM worker

- [ ] Deploy the API's persistent worker process as a long-running VM process,
  not a short-lived request or preview process.
- [ ] Verify one worker owner, graceful restart, startup recovery, and that
  scheduler state is persisted in `scheduler_jobs`.
- [ ] Verify the worker remains alive after an idle period and reconnects to
  the database after a restart.
- [ ] Confirm the worker's logs contain scheduler claims, skips, failures,
  next-run times, and job keys without credentials or provider payloads.
- [ ] Never manually run a feed or prediction command merely to make this
  checklist green.

## Production database via Replit Publish

- [ ] Provision/select the production database in the Replit Publish flow and
  verify its connection is distinct from development.
- [ ] Review the Publish schema diff and take the Replit backup/checkpoint
  before applying a schema change.
- [ ] Do not point the development migration runner at production. Production
  schema changes are owned by Replit Publish and its review/backup flow; never
  use a deploy-time schema push or startup migration against production.
- [ ] Preserve historical games, feature rows, odds and injury snapshots,
  prediction snapshots, training runs, promotion history, and grades.
- [ ] Record backup/checkpoint identifier, restore owner, recovery point
  objective, recovery time objective, and the tested rollback decision.

## Environment secrets (values must not be recorded)

- [ ] Configure production environment variables only in Replit Secrets or the
  Publish environment; do not commit values, print them, or put them in
  reports.
- [ ] Configure `DATABASE_URL` for the production database and verify the
  application and worker use the intended environment.
- [ ] Keep the automated production database smoke check enabled in the API
  deployment startup path after every publish; do not bypass a failed check.
- [ ] Configure the production Clerk publishable/secret credentials, Clerk
  issuer/configuration, `ADMIN_USER_IDS` (or the approved production admin
  role), and Odds API credentials as applicable.
- [ ] Confirm development and production values are separate, rotated where
  necessary, and unavailable to client bundles and logs.
- [ ] Record only secret names, presence/absence, owner, and rotation date;
  never record secret values.

## Managed Clerk development/production separation

- [ ] Use separate managed Clerk development and production instances or
  environments, with their own domains, keys, redirect URLs, and allowed
  origins.
- [ ] Sign in and sign out using the production Clerk configuration at the
  production URL; confirm the session is not a development session.
- [ ] Verify the production administrator is explicitly authorized by the
  production `ADMIN_USER_IDS` or role configuration.
- [ ] Verify anonymous users and ordinary users receive authorization failures
  for manual sync, model training/refit, and model promotion mutations.
- [ ] Verify promotion safety failures do not create a promotion record or
  change the active production model.
- [ ] Do not put Clerk secret keys or user identifiers beyond the approved
  administrator configuration into evidence artifacts.

## Scheduled jobs

- [ ] Confirm persisted jobs are enabled and have a future `next_run_at`:
  schedule coverage, injury refreshes, odds captures, NFLverse completed
  windows, prediction snapshots, kickoff freezes, grading/reporting, and
  challenger training.
- [ ] Confirm times are interpreted in `America/New_York`, including DST
  transitions and kickoff-relative jobs.
- [ ] Confirm a restart records a safe skip/recovery rather than an upstream
  catch-up burst. Check `last_status`, `last_error`, and `last_result`.
- [ ] Confirm only one worker claims a due occurrence and that lock expiry
  permits recovery from a stopped process.

## Odds API quota

- [ ] Confirm the production Odds API plan, allowed sports/markets/books, and
  quota owner before enabling the worker.
- [ ] Verify the configured cadence and kickoff-relative captures fit the
  quota. A scheduler skip for an inapplicable game must not consume a request.
- [ ] Monitor persisted request status, HTTP status, records processed,
  credits used, and credits remaining; alert before the remaining quota is
  exhausted.
- [ ] Confirm provider errors, unmatched events, post-kickoff observations, and
  duplicate observations are visible in Data Health. Never hide quota
  exhaustion behind an empty odds result.
- [ ] Review the readiness report's expected request cost (three configured
  markets), remaining quota, and explicit affordability decision before enabling
  any higher-frequency cadence.
- [ ] Treat any `NOT READY` verdict, stale quote beyond 15 minutes, missing
  adaptive job lease, or unaffordable next request as a release blocker.

## Data Health

- [ ] Schedule sync has a recent successful run and covers the current and
  future unfinished schedule.
- [ ] Injury sync has a recent successful run; keep the known ESPN live
  depth-chart limitation visible if that endpoint has no usable rows.
- [ ] NFLverse has refreshed the latest completed game window, or is explicitly
  pending because no completed window exists.
- [ ] Odds have a recent successful capture for the applicable upcoming games,
  with legitimate pre-kickoff timestamps.
- [ ] Pregame feature rows exist for both teams and show their source cutoff
  before kickoff. Low-sample and unavailable features remain visible.
- [ ] Failed/stale status is not cleared by a UI action; inspect the persisted
  run and scheduler evidence instead.

## Logging and operations

- [ ] Enable Replit App Monitoring email alerts for the published app and assign
  an operator recipient. A failed production database startup gate leaves the
  app unavailable, so App Monitoring sends the rate-limited downtime alert.
- [ ] For a database startup alert, find
  `production_database_startup_gate_failed` in deployment logs and use its
  `failureCategory` to triage. The event intentionally excludes database URLs,
  credentials, hosts, and raw error messages.
- [ ] Route, worker, scheduler, feed, authorization, promotion, freeze, grade,
  and backup failures are logged with a correlation/request or job key.
- [ ] Logs contain error class and operational context but no API keys, Clerk
  secrets, database URLs, raw authorization headers, or provider payloads.
- [ ] Configure retention, alert routing, and an owner for worker death,
  repeated feed failures, stale data, failed safety gates, quota exhaustion,
  database connection errors, and unauthorized mutation attempts.
- [ ] Keep the read-only report and deployment decision with the release
  record.

## Model promotion state

- [ ] Confirm one explicitly promoted production model for each `spread`,
  `moneyline`, and `totals` family.
- [ ] Confirm the active versions are compatible Phase 6 refits, use the
  approved feature version and training cutoff, and have finite validation
  evidence.
- [ ] Confirm challenger/refit runs are append-only evidence and no candidate
  becomes active automatically.
- [ ] Promotion is an administrator action. Review the candidate validation,
  safety gate, reason, operator, and resulting prediction revision before
  serving it.
- [ ] If any gate fails, verify the active promotion history is unchanged.

## Prediction safety

- [ ] Generate snapshots only from pregame features and legitimate
  pre-prediction markets; preserve training cutoff and model versions.
- [ ] Check finite scores, margins, totals, and probabilities before serving
  a snapshot. Invalid output is rejected and recorded as a validation failure.
- [ ] Before kickoff, select/freeze the latest valid official prediction.
- [ ] After kickoff, predictions are immutable: a late feed update must not
  create or alter an official prediction. A read-only report cannot simulate
  this mutation; wait for the real kickoff guard verification.
- [ ] Never imply a betting recommendation, confidence guarantee, or CLV when
  the legitimate pregame market line is unavailable.
- [ ] Confirm the report's canonical snapshot is the latest valid evidence at
  or before the immutable 30-minute cutoff, not a favorable later timestamp.
- [ ] After kickoff, verify Final pre-kickoff observations are strictly before
  kickoff and remain distinct from a sportsbook closing line.

## Backup and recovery

- [ ] Take a Replit Publish backup/checkpoint before production schema or
  deployment changes.
- [ ] Confirm backup coverage for games, source snapshots, odds, features,
  predictions, grades, model runs, promotion history, scheduler state, and
  migration history.
- [ ] Test or schedule a restore rehearsal in an isolated environment and
  record the result, owner, RPO/RTO, and rollback trigger.
- [ ] A failed restore or unverified checkpoint is a go-live blocker.

## Real-time production-cycle steps (wait for the real game)

These checks must not be fabricated by inserting rows or manually replaying
production mutations:

1. Wait for a real upcoming game and a current schedule.
2. Observe injury, NFLverse, odds, and pregame feature refreshes through the
   worker.
3. Observe an official pre-kickoff prediction snapshot using the active
   promoted models.
4. At/around kickoff, observe the scheduled freeze and verify no later
   prediction write can replace it.
5. Wait for ESPN to persist final scores; do not mark a game complete by hand.
6. Observe prediction grading and CLV measurement. CLV is only eligible when
   the snapshot had a legitimate pre-prediction market line and a closing
   market can be measured.
7. Observe the performance/weekly learning report after completed data exists.
8. Observe challenger/refit training after the completed data window is
   available; review and explicitly promote any candidate separately.

Until these events have occurred and their persisted evidence is reviewed,
the correct state is **pending**, not **pass**.

## Readiness report interpretation

The report is read-only and never refreshes feeds, generates predictions, freezes
snapshots, grades games, or repairs rows. Omit `--away`/`--home` to select the
nearest upcoming game, or pass both abbreviations to target a matchup. `READY`
is strict: it requires no warnings or pending checks; otherwise the verdict is
`NOT READY` and the report's blockers must be resolved or explicitly accepted by
an administrator.
