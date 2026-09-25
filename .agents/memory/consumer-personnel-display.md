---
name: Consumer personnel display boundary
description: Why user-visible current depth must remain separate from immutable model personnel context.
---

User-visible matchup depth must come from the cutoff-safe, matchup-season current-personnel interpretation. Do not let an older persisted model-context payload overwrite or repopulate displayed starters.

**Why:** Immutable pregame model context can remain valid for audit and prediction provenance while its serialized personnel names lag later roster evidence. Treating it as the current display source exposed prior-season players in a current matchup.

**How to apply:** Keep model inputs and historical audits unchanged, but overlay consumer depth and injury presentation from the current season-bound interpreter. If current evidence is unavailable, show an explicit unavailable state rather than falling back to persisted names.

For QB-change warnings, never turn a numeric confidence input into an assumed named incumbent. A saved prediction without a named QB can disclose that its current-QB comparison is unverified; withhold an official recommendation only when cutoff-safe saved identity or pre-snapshot personnel evidence and later supported replacement evidence establish a real transition. Do not alter the immutable score.

**Why:** A published matchup's saved feature vector contained only a QB-confidence difference while its separate older personnel context identified an unrelated prior-season quarterback. Using that context as if it represented the numeric model would both misstate model inputs and gate recommendations for an unproven identity change.

**How to apply:** Compare the saved evidence timestamp and team identities with current projected QB evidence, require supported identity and chronology for a change, and keep "comparison unverified" distinct from "recommendation suppressed."