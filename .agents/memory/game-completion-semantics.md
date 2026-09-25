---
name: Game completion semantics
description: How to distinguish completed NFL games from scheduled rows that already contain score-shaped values.
---

Treat game status as the authoritative completion signal. A non-null score is not sufficient because scheduled ESPN rows may persist 0–0 values before kickoff.

**Why:** Audits and grading queries can misclassify future games as completed if they use score nullability alone.

**How to apply:** Gate results, grading, and completion coverage on a final/completed status, then validate scores within that completed subset.

For board slate selection, a scheduled status with a past kickoff is not evidence of a game still being live indefinitely. Bound inferred live selection to a plausible game window, then use persisted upcoming or latest past kickoffs.

**Why:** Persisted provider statuses can remain scheduled long after kickoff; treating every past kickoff as live strands visitors on an old slate.

**How to apply:** Distinguish official final results from inferred live display, especially when picking the default week across postseason and calendar-year boundaries.