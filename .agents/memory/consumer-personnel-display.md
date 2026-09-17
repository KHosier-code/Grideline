---
name: Consumer personnel display boundary
description: Why user-visible current depth must remain separate from immutable model personnel context.
---

User-visible matchup depth must come from the cutoff-safe, matchup-season current-personnel interpretation. Do not let an older persisted model-context payload overwrite or repopulate displayed starters.

**Why:** Immutable pregame model context can remain valid for audit and prediction provenance while its serialized personnel names lag later roster evidence. Treating it as the current display source exposed prior-season players in a current matchup.

**How to apply:** Keep model inputs and historical audits unchanged, but overlay consumer depth and injury presentation from the current season-bound interpreter. If current evidence is unavailable, show an explicit unavailable state rather than falling back to persisted names.