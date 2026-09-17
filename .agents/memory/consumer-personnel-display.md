---
name: Consumer personnel display boundary
description: Why user-visible current depth must remain separate from immutable model personnel context.
---

User-visible matchup depth must come from the cutoff-safe, matchup-season current-personnel interpretation. Do not let an older persisted model-context payload overwrite or repopulate displayed starters.

Keep three independent user-visible states: published depth, current availability, and Gridline's expected lineup. An unavailable published starter remains the published starter; an evidence-backed replacement is a separate projected record and is never labeled official.

Availability precedence is chronological: a newer authoritative injury observation can override older verified depth availability, while a newer verified observation can supersede an older injury report. Inferred rank-one rows must never become published starters.

**Why:** Immutable pregame model context can remain valid for audit and prediction provenance while its serialized personnel names lag later roster evidence. Treating it as the current display source exposed prior-season players in a current matchup. Source labels alone are insufficient when evidence arrives at different times.

**How to apply:** Keep model inputs and historical audits unchanged, but overlay consumer depth and injury presentation from the current season-bound interpreter. If current evidence is unavailable, show an explicit unavailable state rather than falling back to persisted names. Preserve provenance and fail closed when replacement or role evidence is ambiguous.