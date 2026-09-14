---
name: Pregame feature chronology
description: Rules for generating historical pregame features when schedule coverage is incomplete.
---

Pregame features must be built from normalized team-game rows, not only the schedule table. Use stored kickoff timestamps when available and a deterministic season/week/game-date fallback for historical rows; keep feature definitions versioned so coverage fixes never silently rewrite an old version.

**Why:** The persisted schedule is intentionally limited to live and near-future coverage, while normalized NFLverse history spans every loaded season.

**How to apply:** Treat a feature version as immutable. Add a new version when the source coverage or chronological ordering rule changes, and expose unsupported metrics rather than filling them with proxies.