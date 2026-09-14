---
name: Model candidate selection
description: How Gridline should rank walk-forward model candidates without overreacting to a small current season.
---

Gridline should select review candidates using multi-season historical walk-forward averages, not the single best fold or the current season when its completed-game sample is small. Current-season results remain visible as out-of-sample evidence but do not determine promotion.

**Why:** A tiny current-season fold can produce an apparently superior log loss or error metric by chance and would make promotion unstable.

**How to apply:** Require several completed historical test seasons for ranking. Report the current season separately, with its sample size and limitations, before any administrator promotion workflow.