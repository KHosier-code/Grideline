---
name: Current depth-mapping readiness
description: The authoritative population and gates for evaluating whether Sleeper identity mapping can support current depth logic.
---

Evaluate depth readiness on current canonical-team rows with a non-null depth order and a supported normalized role slot. Exclude teamless/free-agent rows, but do not exclude rostered inactive players because injuries and inactive designations still affect depth interpretation.

**Why:** Broad all-history coverage included teamless rows, while an isolated mapping report was not reproducible after merge. Current usability requires immutable run provenance and role-level starter checks, not only one aggregate percentage.

**How to apply:** Require at least 90% current-depth and current order-1 coverage, 100% QB1, at least 90% for WR1-3, CB1-2, EDGE/LB/safety starter groups, sufficient OL slot evidence, zero selected-starter collisions, and zero ambiguous starter identities. Normalize provider role slots before cohorting.