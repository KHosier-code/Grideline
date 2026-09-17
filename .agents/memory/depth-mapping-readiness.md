---
name: Current depth-mapping readiness
description: The authoritative population and gates for evaluating whether Sleeper identity mapping can support current depth logic.
---

Evaluate depth readiness on current canonical-team rows with a non-null depth order and a supported normalized role slot. Freshness belongs to each evidence row and role card; one new team observation must never refresh unrelated old rows. Exclude teamless/free-agent rows, but do not exclude rostered inactive players because injuries and inactive designations still affect depth interpretation.

Keep audit role-card identity separate from depth order. A role card identifies the lineup slot; rank 1 is its published starter and higher ranks are evidence-backed replacements. QB2 and RB2 remain explicit backup cards.

Stale published rows may remain visible as historical depth evidence, but they cannot satisfy current coverage, current QB evidence, or expected-lineup selection. Replacement candidates must be fresh independently of the starter.

**Why:** Broad all-history coverage included teamless rows, while an isolated mapping report was not reproducible after merge. Team-level maximum timestamps also made stale roles appear current after any one role was updated. Current usability requires immutable run provenance and role-level starter and freshness checks, not only one aggregate percentage.

**How to apply:** Require at least 90% current-depth and current order-1 coverage, 100% QB1, at least 90% for WR1-3, CB1-2, EDGE/LB/safety starter groups, sufficient OL slot evidence, zero selected-starter collisions, and zero ambiguous starter identities. Normalize provider role slots before cohorting. Match replacements to the vacated role card, not merely the broad position.