---
name: Game completion semantics
description: How to distinguish completed NFL games from scheduled rows that already contain score-shaped values.
---

Treat game status as the authoritative completion signal. A non-null score is not sufficient because scheduled ESPN rows may persist 0–0 values before kickoff.

**Why:** Audits and grading queries can misclassify future games as completed if they use score nullability alone.

**How to apply:** Gate results, grading, and completion coverage on a final/completed status, then validate scores within that completed subset.