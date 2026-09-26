---
name: Player usage windows
description: Chronology and completeness rules for consumer rolling player-usage summaries.
---

Define Last 3, Last 5, and Last 8 from the team's eligible games ordered by actual kickoff time, then join player evidence into that fixed window. Never select a player's last N appearances.

**Why:** Appearance-based windows backfill older games when a player has no row in a recent team game, overstating coverage and changing the intended period. Week numbers also fail for postponed or rescheduled games.

**How to apply:** Build team game IDs strictly before the applicable cutoff, sort by kickoff timestamp, select the requested window, and preserve missing player rows as partial coverage. Use the same rule for matchup detail context. When schedule coverage is absent, withhold source-only usage as unavailable: season/week chronology cannot establish kickoff or completion before the cutoff. Restore that path only with independently verified source-game completion evidence.