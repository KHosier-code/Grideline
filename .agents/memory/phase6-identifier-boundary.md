---
name: Phase 6 identifier boundary
description: Canonicalization rule for joining schedule games to nflverse feature, QB, and score history.
---

Normalize source team identifiers into the schedule's canonical ID space before building feature history or joining outcomes. Include historical franchise aliases in the same boundary.

**Why:** Schedule rows and nflverse rows use different namespaces; mixing them can produce apparently valid future rows with empty history, unavailable QB evidence, and no training examples.

**How to apply:** Any Phase 6 feature, QB, or outcome join that combines schedule and nflverse data must canonicalize both sides first and preserve the original source identity only for audit evidence.