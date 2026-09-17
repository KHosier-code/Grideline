---
name: Player usage source identities
description: Cross-source season and identifier rules for persisted player-game and snap usage.
---

Treat schedule games, player-game stats, and snap counts as independent persisted datasets. Standalone usage uses the latest season actually present in player-game stats; matchup-filtered usage stays on the selected matchup season and reports unavailable data rather than falling back.

**Why:** Schedule coverage can be newer than player-game coverage, schedule game IDs do not match snap game IDs, and player-game rows use GSIS player IDs while snap rows use PFR IDs.

**How to apply:** Reconcile games by canonical season, week, team, and opponent; resolve players through the persisted GSIS-to-PFR identity crosswalk; use raw source IDs only as provenance, not join keys.