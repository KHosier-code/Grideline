# Sleeper mapping coverage reconciliation

## Scope

This audit preserves the earlier Task 62 and C0 reports. It does not rewrite either result and does not change models, predictions, starters, QB confidence, consumer UI, or production data.

## Reproduction status

The C0 result is reproducible from immutable development records:

- Source snapshot: `77ad8249-bd81-41fe-87a7-e3e0d5e15668`
- Source capture: `2026-09-17T01:56:56.606Z`
- Parser: `v2-latest-team`
- Mapper: `sleeper-identity-v4-c0-crosswalk`
- Candidate fingerprint: `c6429b4ac805d95ab78b4114bbefb3bfd6d91f3a703b09a596094b5944f51e16`
- Depth order: 1,077 / 1,524 = 70.67%
- Depth order 1: 407 / 544 = 74.82%

The earlier Task 62 report implies:

- Depth order: 1,421 / 1,524 = 93.24%
- Depth order 1: 533 / 544 = 97.98%

No immutable mapping run, source snapshot ID, source capture, mapping-input fingerprint, or row-level mapping output for the 93.24% / 97.98% result exists in the merged development database. The result came from the isolated task environment and cannot be independently replayed from merged evidence. Its denominator counts match C0, but exact row membership cannot be proven.

The merged v5 mapper was replayed against the exact C0 snapshot:

- Mapper: `sleeper-identity-v5-verified-crosswalk`
- Candidate fingerprint: `39b7517d1bc45311fb034c844e2cb963a83af806156d0903b4339b749a92a1c0`
- Depth order: 1,322 / 1,524 = 86.75%
- Depth order 1: 487 / 544 = 89.52%

## Cause

The quoted reports did not use different denominator formulas. Both broad metrics count every Sleeper row with `depth_chart_order`, and both order-1 metrics count every row with `depth_chart_order = 1`. They apply no current-team, current-status, or supported-position filter to those denominators.

The discrepancy is an evidence/candidate-set difference:

- Task 62 used an isolated, downloaded nflverse crosswalk and did not preserve its run inputs in the merged database.
- C0 used immutable parser-versioned nflverse rows and typed crosswalk revisions.
- The merged v5 mapper combines those approaches, adds provider-owner uniqueness and name compatibility, and produces a third result on the shared database.
- Ambiguous mappings are excluded from every numerator.

On the exact C0 snapshot, v4 to merged v5 changed 267 depth-row outcomes: 256 gained a mapping and 11 lost one, for a net increase of 245. Among order-1 rows, 82 gained and 2 lost, for a net increase of 80. The exact rows are in `c0-v5-depth-mapping-delta.csv`.

The original Task 62 result is 99 depth mappings and 46 order-1 mappings above the merged v5 replay. Those rows cannot be named because the isolated mapping output was not persisted.

## Broad versus current cohorts

| Cohort | Mapped | Eligible | Coverage | Ambiguous | Unmatched |
|---|---:|---:|---:|---:|---:|
| All depth-order rows | 1,322 | 1,524 | 86.75% | 17 | 185 |
| Current-team depth rows | 1,317 | 1,472 | 89.47% | 12 | 143 |
| Active-status current-team depth rows | 1,217 | 1,362 | 89.35% | 10 | 135 |
| Current-team order-1 rows | 487 | 543 | 89.69% | 1 | 55 |
| Current QB1 rows | 32 | 32 | 100.00% | 0 | 0 |

The broad denominator contains 52 teamless rows. The current-team cohort contains 1,362 active rows, 109 inactive rows, and one practice-squad row. Current-team depth rows remain in the readiness population regardless of status because an injured or inactive player can still materially affect depth interpretation.

After normalizing Sleeper role slots, every current-team depth row belongs to a supported position group. Important aliases include LWR/RWR/SWR to WR, LCB/RCB/NB to CB, FS/SS to S, LDE/RDE/LOLB/ROLB to EDGE, and LILB/RILB/MLB to LB.

## Current position coverage

| Position | Mapped | Eligible | Coverage | Ambiguous | Unmatched |
|---|---:|---:|---:|---:|---:|
| QB | 90 | 92 | 97.83% | 1 | 1 |
| RB | 129 | 133 | 96.99% | 0 | 4 |
| WR | 207 | 212 | 97.64% | 2 | 3 |
| TE | 139 | 143 | 97.20% | 1 | 3 |
| OL | 0 | 1 | 0.00% | 0 | 1 |
| EDGE/DE | 263 | 295 | 89.15% | 3 | 29 |
| DT | 101 | 105 | 96.19% | 2 | 2 |
| LB | 119 | 123 | 96.75% | 2 | 2 |
| CB | 182 | 198 | 91.92% | 1 | 15 |
| S | 55 | 138 | 39.86% | 0 | 83 |
| K | 32 | 32 | 100.00% | 0 | 0 |
| P | 0 | 0 | N/A | 0 | 0 |

## Starter-critical coverage

Eligibility is the expected number of team starter slots across 32 teams. Missing provider rows count as unresolved.

| Role | Published | Mapped | Eligible | Coverage | Unresolved | Ambiguous |
|---|---:|---:|---:|---:|---:|---:|
| QB1 | 32 | 32 | 32 | 100.00% | 0 | 0 |
| RB1 | 32 | 32 | 32 | 100.00% | 0 | 0 |
| WR1 | 32 | 32 | 32 | 100.00% | 0 | 0 |
| WR2 | 32 | 32 | 32 | 100.00% | 0 | 0 |
| WR3 | 32 | 31 | 32 | 96.88% | 1 | 0 |
| TE1 | 32 | 32 | 32 | 100.00% | 0 | 0 |
| LT | 0 | 0 | 32 | 0.00% | 32 | 0 |
| LG | 0 | 0 | 32 | 0.00% | 32 | 0 |
| C | 0 | 0 | 32 | 0.00% | 32 | 0 |
| RG | 0 | 0 | 32 | 0.00% | 32 | 0 |
| RT | 0 | 0 | 32 | 0.00% | 32 | 0 |
| EDGE starters | 64 | 57 | 64 | 89.06% | 7 | 1 |
| LB starters | 63 | 63 | 64 | 98.44% | 1 | 0 |
| CB1 | 32 | 26 | 32 | 81.25% | 6 | 0 |
| CB2 | 32 | 28 | 32 | 87.50% | 4 | 0 |
| CB3/slot | 32 | 29 | 32 | 90.63% | 3 | 0 |
| Starting safeties | 64 | 31 | 64 | 48.44% | 33 | 0 |

Selected-starter identity collisions: 0.

## Authoritative readiness definition

Use one immutable mapping run and source cutoff. The population is every row with:

1. a canonical current NFL team;
2. a non-null current Sleeper depth order; and
3. a normalized supported role slot.

Do not require active status, because injured/inactive rostered players still affect current depth interpretation. Report active status as a separate cohort. Never include free agents or teamless rows. Never count ambiguous identities as mapped.

Readiness requires all of:

- current-depth mapping at least 90%;
- current order-1 mapping at least 90%;
- QB1 mapping 100%;
- WR1, WR2, WR3, CB1, and CB2 each at least 90%;
- EDGE, LB, and safety starter groups each at least 90%;
- sufficient published OL slot evidence for the consumer depth scope;
- zero selected-starter identity collisions; and
- zero ambiguous starter identities.

The current capture fails current-depth, order-1, CB1, CB2, EDGE, safety, OL availability, and starter-ambiguity requirements.

The WR side is sufficient, but CB1 and CB2 are below 90%, so the WR-CB matchup foundation does not pass.

## Validity conclusions

- The earlier 93.24% / 97.98% figures are mathematically valid under the scope stated in their report, but are not independently reproducible or acceptable as the authoritative gate because their immutable run inputs and row outputs were not merged.
- The C0 70.67% / 74.82% figures are valid and reproducible under their broad all-depth scope.
- Neither broad historical metric is the correct current-depth readiness definition.
