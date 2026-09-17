---
name: Pregame feature chronology
description: Rules for generating historical pregame features when schedule coverage is incomplete.
---

Pregame features must be built from normalized team-game rows, not only the schedule table. Use stored kickoff timestamps when available and a deterministic season/week/game-date fallback for historical rows; keep feature definitions versioned so coverage fixes never silently rewrite an old version.

**Why:** The persisted schedule is intentionally limited to live and near-future coverage, while normalized NFLverse history spans every loaded season.

Live inference must reject a game when any model-selected feature is unavailable; never turn a fully incomplete feature set into an all-zero vector. Persist input completeness on prediction snapshots so consumer reads can reject legacy or unverifiable outputs.

**Why:** Early-season feature rows can legitimately contain no eligible history. Silently converting every missing home/away value to zero gives unrelated games the same deterministic projection while still producing mathematically valid scores.

**How to apply:** Treat completed-game feature evidence as immutable. Add a new version when historical source coverage or chronological ordering changes. Future-game rows may refresh as new pre-kickoff history arrives, but unsupported inputs remain unavailable and block snapshot generation rather than becoming numeric proxies.

Future-only repair must still iterate completed games to accumulate chronological team and quarterback history; filter only row emission/persistence. Guard inserts and updates with authoritative game identity and database clock time so crossing kickoff cannot create or rewrite evidence.

**Why:** Filtering completed games before history accumulation produces empty future vectors, while application timestamps or conflict-only guards can still admit late inserts.

**How to apply:** Let completed sources advance in-memory history, emit only future targets, set generation time from the database clock, and require both source cutoff and generation time to be strictly before kickoff.

Consumer-facing retrospective assessments must read immutable, game/team-keyed pregame feature rows and their per-metric sample counts, not mutable normalized source rows filtered by their latest ingestion timestamp.

**Why:** Source upserts can advance ingestion timestamps long after a game, making valid historical evidence disappear or changing what a retrospective cutoff appears to contain.

**How to apply:** Reuse the immutable pregame row for the requested game, enforce a strictly pre-kickoff source cutoff, and derive availability and confidence from each metric's persisted sample count.