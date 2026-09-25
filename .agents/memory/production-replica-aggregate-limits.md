---
name: Production replica aggregate limits
description: How to interpret ambiguous read-only production aggregate responses.
---

Broad read-only aggregates over historical player-game statistics can return only `START TRANSACTION` and `ROLLBACK` through the production query interface, without result rows or a clear error. An empty result in that form is **not** evidence of zero records or an absent table.

**Why:** Multiple attempts to count grouped and season-filtered historical player statistics produced these transaction wrappers, while smaller reads and other season aggregates succeeded. Treating the wrappers as data would yield a false recovery verdict.

**How to apply:** Prefer bounded/indexed reads or independently persisted source and API coverage evidence. If an exact count still cannot be obtained, explicitly mark that count unverified rather than inferring absence.