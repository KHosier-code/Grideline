---
name: Pregame feature chronology
description: Rules for generating historical pregame features when schedule coverage is incomplete.
---

Pregame features must be built from normalized team-game rows, not only the schedule table. Use stored kickoff timestamps when available and a deterministic season/week/game-date fallback for historical rows; keep feature definitions versioned so coverage fixes never silently rewrite an old version.

**Why:** The persisted schedule is intentionally limited to live and near-future coverage, while normalized NFLverse history spans every loaded season.

Live inference must reject a game when any model-selected feature is unavailable; never turn a fully incomplete feature set into an all-zero vector. Persist input completeness on prediction snapshots so consumer reads can reject legacy or unverifiable outputs.

**Why:** Early-season feature rows can legitimately contain no eligible history. Silently converting every missing home/away value to zero gives unrelated games the same deterministic projection while still producing mathematically valid scores.

**How to apply:** Treat completed-game feature evidence as immutable. Add a new version when historical source coverage or chronological ordering changes. Future-game rows may refresh as new pre-kickoff history arrives, but unsupported inputs remain unavailable and block snapshot generation rather than becoming numeric proxies.