# Verified depth and injury truth

## Scope

This report documents the current personnel truth boundary delivered for task
150. Development contains a manually verified DET/BUF evidence snapshot, while
both the matchup and all-team audits remain `not_ready` because unresolved
source/identity ambiguity is preserved instead of converted into player facts.

## Evidence contract

`verified_depth_evidence` is append-only and records team/player identity,
supported role and rank, evidence state, availability and injury status,
confidence, source and URL, observed and verified timestamps, verification
method, source hash, and provenance. A safe manual verification workflow may
insert a row after a human compares permissible material. No prohibited
automated source extraction is introduced.

Administrators submit evidence through the validated
`POST /api/features/personnel/current/verified-depth/import` path. It accepts
only supported role cards, canonical team/player identities, matching
positions, positive depth ranks, HTTP(S) source URLs, valid
observation/verification chronology,
SHA-256 source hashes, and complete provenance. The read path reconstructs the
latest observation per team/role/rank. The role card identifies the audited
lineup slot, while depth rank identifies the ladder within that slot, so a
verified backup can be entered for every supported role. Role-wide unavailable
or ambiguous observations act as tombstones and suppress older and
lower-priority depth rows. Readiness uses required role/rank pairs: QB2 and RB2
require rank 2, while every starter card requires rank 1. A single player
cannot satisfy more than one required card; cross-card identity collisions
fail readiness.

The interpretation contract has three independent tracks:

1. **Published depth** — the provider-published rank and role remain intact.
2. **Availability** — current injury evidence overlays the published player and
   can mark that published starter out, questionable, doubtful, or unknown.
3. **Expected lineup** — a separate projected record. A replacement is emitted
   only when cutoff-safe mapped depth or participation evidence supports it.

No expected player is labeled official, and direct WR-CB assignments remain
fail-closed. Each team payload also includes structured published-starter
availability counts overall and by offense, defense, and special teams.
Displayed depth distinguishes published starters, published backups, projected
starters, projected backups, and genuinely uncertain records. Stale evidence
remains visible as stale published depth but cannot enter the expected lineup
or satisfy verified coverage.
Complete supported depth ladders are not truncated in the consumer contract.
Both observation and human verification timestamps must be at or before the
requested matchup cutoff.

## Reports

- `GET /api/features/personnel/current/report/det-buf` returns the DET/BUF
  report with a `ready` boolean, explicit `not_ready` verdict, depth, injury,
  expected-lineup, freshness, and blocking-conflict evidence.
- `GET /api/features/personnel/current/validation` remains the independent
  all-32 coverage audit. It reports verified, published, projected, unknown,
  and ambiguous percentages overall and by requested role card, plus conflicts,
  unavailable reasons, source state, and an independent readiness verdict. A
  ready verdict requires current verified evidence for every requested role on
  all 32 teams with no blocking ambiguity.

## DET/BUF development verification run

The following results describe one auditable development-database run, not a
repository fixture or a claim about production. The sources were observed at
`2026-09-17T17:47:36.684Z` and verified at
`2026-09-17T17:48:36.684Z`.

- **DET:** Detroit Lions Football Communications' official team site,
  “2026 Unofficial Depth Chart,” was reviewed directly. Sixteen role cards
  were reconciled to canonical Gridline players and eleven were recorded as
  ambiguous where exact safety role or current canonical identity support was
  absent. Current ESPN injury snapshots overlay seven reported players by
  canonical identity and timestamp.
- **BUF:** ESPN/RotoWire's published 2026 depth chart was manually compared
  with the official Buffalo Bills roster because the Bills' official depth
  page says the 2026 chart will be announced later. Thirteen role cards were
  reconciled to canonical Gridline players and fourteen were recorded as
  ambiguous rather than forcing an identity. Current ESPN injury snapshots
  overlay six reported players by canonical identity and timestamp.
- **Persistence:** 54 append-only observations were inserted in development:
  29 verified and 25 ambiguous. Each row stores its source URL, content hash,
  observation and verification timestamps, method, source position, identity
  outcome, and injury-lineage note.
- **Source hashes:** Detroit
  `17200e3158cd9e4ce65eaf69200c9906799ded6963c9aec3cdaa758a6e5e0b24`;
  Buffalo depth plus official-roster cross-check
  `149820a025d077f7c1dc9442c3ae6d8450e057731d376e118e2e0164dd3b22c0`.
- **DET/BUF verdict:** `not_ready`. DET role-card coverage is 59% verified and
  BUF is 48% verified. Expected lineups remain partial because unsupported
  roles and blocking identity/depth conflicts are visible. Neither team had a
  cross-card verified-player collision in this run.
- **All-32 verdict:** `not_ready`. The audit observed all 32 teams across 864
  requested cards: 3% verified, 26% published, 13% projected, 48% unknown, and
  10% ambiguous.

The persisted run can be checked without mutation:

```sql
SELECT t.abbreviation, v.evidence_state, count(*) AS observations
FROM verified_depth_evidence v
JOIN teams t ON t.team_id = v.team_id
WHERE t.abbreviation IN ('DET', 'BUF')
  AND v.verified_at = '2026-09-17T17:48:36.684Z'
GROUP BY t.abbreviation, v.evidence_state
ORDER BY t.abbreviation, v.evidence_state;
```

Expected result: DET has 16 verified and 11 ambiguous observations; BUF has
13 verified and 14 ambiguous observations. This query verifies environment
state only; it does not make the rows a deployable fixture.

## Release boundary

Task 150 does not modify the Phase 6.1 feature schema, model training,
prediction, grading, canonical-market, odds-ingestion, or odds-scheduling
files. The branch inherits independently merged mainline work in those areas;
that behavior is not part of this task's diff or verification claim.

Migration `0033_verified_depth_evidence.sql` was applied in development, where
direct checks confirmed UPDATE and DELETE are blocked. Production still
requires Publish/post-publish schema verification; development evidence is not
copied into production by Publish. After Publish, an administrator must
re-observe the then-current sources and submit a fresh validated snapshot
through the import endpoint before production readiness is evaluated. The
development snapshot must not be copied forward after it is stale.