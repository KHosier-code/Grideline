# GL-002 release candidate — 2026-09-25

## Decision

**Code decision: GO. Publish decision: NO-GO until administrator approval is explicitly recorded.**

The reviewed implementation is commit `35940afc56a5ef264917f07bcc3e05670dac41df`
(`Align consumer odds freshness with capture cadence`). Production was not
changed. No production migration, provider probe, model promotion, prediction
run, freeze, grade, data repair, or worker restart was performed.

## Why the 15-minute rule was unsafe

The Odds API worker does not run every 15 minutes throughout the week:

- Outside six hours from the nearest kickoff: Tuesday, Thursday, and Saturday
  at 10:00 ET; Sunday at 08:00 and 11:00 ET; plus kickoff-relative Sunday and
  Monday slots.
- Six to one hour before kickoff: every 12 minutes when the remaining quota
  can fund the plan through kickoff.
- Final hour: every five minutes under the same quota admission rule.

Quote history is change-only. A successful request that receives an unchanged
price records a duplicate observation and intentionally does not rewrite the
quote row's `captured_at`. Production confirmed this behavior: the latest
complete observation for the nearest game received all 12 expected sides,
saved two changed states, classified ten as duplicates, and rejected none.
The next 11 games also each received all 12 expected sides with zero
rejections, even where all 12 were unchanged duplicates.

Across the sampled production history, the fixed 15-minute rule suppressed
97.9% of observed time more than six hours before kickoff. The latest state
rows were older than 15 minutes for 97.9% of moneyline sides and 100% of spread
and total sides, despite complete successful re-observation. The rule therefore
measured change frequency, not provider observation freshness.

## Replacement freshness contract

The consumer now separates immutable quote-state time from complete
observation time. An unchanged state becomes eligible only when the latest
successful event audit proves exactly 12 received observations—both sides of
spread, total, and moneyline at DraftKings and FanDuel—with zero rejected
observations. A failed, partial, future-dated, or missing audit cannot refresh
any market.

| Game proximity | Worker cadence | Consumer freshness limit | Markets |
| --- | --- | --- | --- |
| More than six hours | Established weekly slots, maximum normal gap 48 hours | 50 hours | Spread, total, moneyline |
| Six to one hour | 12 minutes | 15 minutes | Spread, total, moneyline |
| Final hour | 5 minutes | 8 minutes | Spread, total, moneyline |

All three markets share the threshold because the accepted verification unit
contains all 12 expected book/market/side observations. Market eligibility is
still evaluated independently: invalid or absent quote pairs suppress only the
affected market. A partial event audit cannot prove which unchanged market was
seen, so it fails closed rather than making old prices look fresh.

The 50-hour limit covers the configured 48-hour maximum normal weekly gap plus
worker/API delay. Historical inactive-worker gaps beyond that limit remain
stale. This distinction also preserves the development diagnosis: the
development API reports old injury, odds, and player observations as stale
while the durable data worker remains `NOT_STARTED`; it does not claim a
provider failure.

## Verification completed

- API targeted suite: 62/62 passed, including cadence boundaries, incomplete
  audits, unchanged old quote states with and without recent verification,
  partial market pairs, kickoff closure, source health, and consumer contracts.
- Final focused suite after query optimization: 52/52 passed.
- Full workspace typecheck passed.
- API production build passed.
- Consumer web production build passed. Vite reported only the existing
  large-chunk and sourcemap warnings.
- Development runtime checks returned HTTP 200 for consumer games and
  dashboard. Recommendations correctly remained stale because the development
  worker is inactive.
- API workflow restarted cleanly with no application error.
- Production read-only coverage snapshot: nearest game plus next 11 each had a
  complete 12-observation, zero-rejection audit and valid two-book/four-side
  spread, total, and moneyline state.
- Production immutable baseline before Publish: 229 prediction snapshots, one
  official snapshot, one frozen snapshot, zero grades, latest prediction at
  2026-09-17 16:00:53.498 UTC.

Current complete market coverage is operational evidence only. It is not a
release correctness gate and it may change before Publish.

## Required pre-Publish checks

1. Confirm the candidate is exactly
   `35940afc56a5ef264917f07bcc3e05670dac41df` plus this gate document only.
2. Confirm no database schema changes are proposed in the interactive Publish
   diff. This candidate changes no schema files. Stop if the UI proposes an
   unexplained production database change.
3. Confirm the live deployment still identifies the existing build based on
   commit `65dfa24517cb87650e34c08d80841bf3a0c08d39`.
4. Recheck source timestamps, worker owner/lease, quota headroom, and the
   nearest game plus next 11 without forcing a provider request.
5. Record explicit administrator approval in the release conversation.
6. The administrator clicks Publish. Agent-side work must not infer approval
   from preparation, successful tests, or current market coverage.

## Required post-Publish checks

1. Confirm `/` and `/api/healthz` return HTTP 200 and the startup-security row
   identifies the new build with database and full verification passing.
2. Confirm the weekly board, a complete upcoming game, a partial upcoming
   game if one exists naturally, a completed game, eligible and excluded
   players, saved projections, and historical results render without mutation.
3. Confirm current recommendations close at kickoff and incomplete or stale
   per-game audits suppress eligibility.
4. Confirm a complete unchanged 12-observation audit advances verification
   time without inserting duplicate quote-state rows.
5. Compare prediction counts and identities against the pre-Publish baseline:
   229 total, one official, one frozen, zero grades. Publishing must not refit,
   promote, regenerate, freeze, or grade models.
6. Confirm the worker remains the only adaptive odds owner, legacy paid-feed
   jobs remain disabled, and quota counters remain plausible.

## Code-only rollback

If any post-Publish check fails:

1. Stop further release actions; do not repair production data and do not run a
   paid provider probe.
2. Open Replit checkpoints and restore the code checkpoint corresponding to
   `65dfa24517cb87650e34c08d80841bf3a0c08d39`.
3. Explicitly exclude the Replit database from restore. Do not change secrets,
   environment bindings, model rows, prediction rows, grades, or feed history.
4. Publish the restored code.
5. Verify `/`, `/api/healthz`, startup-security evidence, worker ownership, and
   the immutable prediction baseline.

Replit does not provide a separate manual published-version rollback action for
this release path. The rollback is code checkpoint restore with the database
excluded, followed by Publish.
