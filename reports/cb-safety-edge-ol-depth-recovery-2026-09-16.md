# CB / safety / EDGE / OL depth recovery

## Provenance and scope

- Authoritative source snapshot: `77ad8249-bd81-41fe-87a7-e3e0d5e15668`
- Source captured at: `2026-09-17T01:56:56.606Z`
- Immutable mapping run: `2162cd9d-3365-489c-b2d0-5da27326a486`
- Mapper: `sleeper-identity-v5-verified-crosswalk`
- Candidate fingerprint: `39b7517d1bc45311fb034c844e2cb963a83af806156d0903b4339b749a92a1c0`

This recovery did not retrain, refit, or promote a model. It did not alter Phase 6.1 features, predictions, or immutable historical evidence. The mapping run was not duplicated because no identity could be safely changed from the preserved evidence.

## Implemented recovery rules

1. Explicit LCB and RCB depth roles now remain distinct cornerback roles when Sleeper supplies a generic DB roster position.
2. FS and SS normalize to the safety position while retaining distinct FS and SS depth slots. Two bare S rank-1 rows still conflict rather than being silently ordered.
3. DE/E/EDGE evidence can normalize to EDGE. A generic OLB or LOLB/ROLB role remains LB unless the roster position is independently edge-compatible.
4. Recent snaps and historical depth can corroborate an offensive lineman's participation, but cannot create an exact current OT/OG/C or LT/LG/C/RG/RT starter slot.
5. Current-team downstream readiness uses the complete required-position set, freshness, QB availability, and blocking conflicts instead of the earlier QB/WR/CB-only shortcut.

Stable provider-ID precedence, provider conflicts, mapping collisions, and ambiguous-identity rejection were not changed.

## Evidence audit

### CB1 / CB2

The authoritative mapping gate remains:

| Role | Before | After | Unresolved |
|---|---:|---:|---:|
| CB1 | 26/32 (81.25%) | 26/32 (81.25%) | 6 |
| CB2 | 28/32 (87.50%) | 28/32 (87.50%) | 4 |

Role interpretation improved for mapped generic-DB rows, but identity coverage did not change. Persisted unresolved CB evidence includes:

- CIN LCB1 Dax Hill (`Sleeper 8286`), active, no injury designation: unmatched, no Gridline candidate. Sleeper supplies secondary IDs but no matching GSIS/ESPN/PFR/nflverse identity.
- LAR LCB1 Jaylen Watson (`Sleeper 8373`), active: unmatched, no Gridline candidate. The apparent current team conflicts with known historical identity evidence, so no name-only mapping was accepted.
- MIA LCB1 JuJu Brents (`Sleeper 10906`), active: unmatched, no Gridline candidate.
- LAR RCB1 Trent McDuffie (`Sleeper 8364`), active: unmatched, no Gridline candidate. Current team evidence conflicts with the known identity, so no mapping was forced.
- Other expected-slot deficits are absent published slot rows rather than hidden candidate identities. Missing provider rows have no Sleeper player, provider ID, snap, injury, or roster evidence to resolve.

The current candidate set contains no stable GSIS/ESPN/PFR evidence that safely resolves these rows. Recent snaps or historical depth alone are not identity proof.

### Safeties

Starting-safety identity coverage remains **31/64 (48.44%) before and after**. FS/SS/S role interpretation is now correct, and the current-personnel validation sees a safety group on all 32 teams, but 33 expected starter identities remain unresolved in the authoritative mapping gate.

The unresolved set is primarily new/current players with no stable provider-ID link in the Gridline candidate set. Examples include ATL FS1 Xavier Watts, BAL FS1 Malaki Starks, BAL SS1 Kyle Hamilton, BUF SS1 Cole Bishop, SEA FS1 Ty Okada, SF FS1 Ji'Ayir Brown, SF SS1 Malik Mustapha, TEN FS1 Kevin Winston, and WAS SS1 Nick Cross. Snap participation can corroborate role and team but cannot replace a stable identity link.

### EDGE

EDGE starter identity coverage remains **57/64 (89.06%) before and after**. Seven expected starter slots remain unresolved. OLB was not globally converted to EDGE.

The one ambiguous selected starter is:

- TEN ROLB1 James Williams (`Sleeper 11847`), active/questionable.
- Candidate Gridline identity: `WIL331782`.
- Status: ambiguous.
- Reason: exact normalized name/position evidence exists, but the candidate's latest team evidence is absent or conflicting.
- Resolution: remain unresolved. A current stable provider crosswalk or authoritative current-team identity record is required.

Selected-starter identity collisions remain zero.

### Offensive line

**OL SLOT EVIDENCE INSUFFICIENT**

The authoritative snapshot supplies no defensible complete LT/LG/C/RG/RT starter set. Recent snaps establish participation, historical depth establishes a prior role, and roster labels establish a broad OL/OT/OG/C family; none proves the current five exact slots.

Required external evidence: a current, timestamped, slot-specific depth chart or starting-lineup source that explicitly names each team's LT, LG, C, RG, and RT, preferably official team/NFL/GSIS evidence, with cutoff-safe injury and availability status.

## Authoritative readiness recompute

The denominator includes only canonical current NFL team rows with non-null current depth order and a supported normalized role. Ambiguous mappings are excluded from mapped numerators.

| Cohort | Mapped | Eligible | Coverage |
|---|---:|---:|---:|
| Current depth | 1,317 | 1,472 | 89.47% |
| Current order 1 | 487 | 543 | 89.69% |
| QB1 | 32 | 32 | 100.00% |
| RB1 | 32 | 32 | 100.00% |
| WR1 | 32 | 32 | 100.00% |
| WR2 | 32 | 32 | 100.00% |
| WR3 | 31 | 32 | 96.88% |
| TE1 | 32 | 32 | 100.00% |
| CB1 | 26 | 32 | 81.25% |
| CB2 | 28 | 32 | 87.50% |
| CB3/slot | 29 | 32 | 90.63% |
| EDGE starters | 57 | 64 | 89.06% |
| LB starters | 63 | 64 | 98.44% |
| Starting safeties | 31 | 64 | 48.44% |
| Exact OL starters | 0 | 160 | 0.00% |

The current-personnel interpretation report now recognizes QB on 32/32 teams, S on 32/32, CB on 31/32, and EDGE on 31/32. It correctly marks 0/32 teams downstream-ready because OT, OG, and C evidence is unavailable on every team.

## Requested final report

1. **CB1 coverage before/after:** 26/32 (81.25%) → 26/32 (81.25%).
2. **CB2 coverage before/after:** 28/32 (87.50%) → 28/32 (87.50%).
3. **Safety coverage before/after:** 31/64 (48.44%) → 31/64 (48.44%) for authoritative mapped starter identities; role normalization now correctly exposes S on 32/32 teams.
4. **EDGE coverage before/after:** 57/64 (89.06%) → 57/64 (89.06%).
5. **OL slot-evidence result:** **OL SLOT EVIDENCE INSUFFICIENT**.
6. **Ambiguous selected starter:** TEN ROLB1 James Williams remains ambiguous; latest team evidence conflicts and no stronger stable identity evidence exists.
7. **Authoritative current-depth coverage:** 1,317/1,472 (89.47%).
8. **Authoritative order-1 coverage:** 487/543 (89.69%).
9. **Unresolved starter count:** 215 across the complete reported expected-slot matrix, including 160 unavailable exact OL slots; 55 excluding OL. One of the seven EDGE gaps is the ambiguous James Williams row.
10. **Tests passed:** 41 focused current-personnel and identity tests, 8 migration-safety tests, and 25 Phase 6 prediction/leakage safety tests; full workspace typecheck passed.
11. **Publish required:** Yes, for the server-side normalization and readiness safeguards to reach production. No schema migration or production-data rewrite is required.
12. **Phase 6.1 untouched:** Confirmed. No Phase 6.1 feature, model, prediction, fitting, promotion, or production artifact file changed.

## Final verdicts

**CURRENT DEPTH LOGIC NOT READY**

**WR-CB FOUNDATION NOT READY**