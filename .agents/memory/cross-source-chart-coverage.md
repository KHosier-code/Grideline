---
name: Cross-source chart coverage
description: Why normalized sports data counts alone cannot validate consumer chart coverage.
---

Raw provider or normalized team-stat row counts are not enough to claim a season is chart-ready. Verify that each observation reconciles with an independently persisted, final schedule game using season, week, both canonical teams and home/away orientation; distinguish unmatched history from supported chart coverage.

**Why:** A read-only audit found apparently complete team-stat seasons that had no matching schedule history, and a current season whose provider game IDs differed from schedule IDs. Both would have made a row-count-based release check misleading.

**How to apply:** Before enabling or describing a season's charts, check the source import, normalized metric rows, schedule coverage and final-game join separately. Report unmatched rows as excluded evidence rather than zero-valued observations or valid games.

For a featured upcoming matchup, label team trends as *season to date* only through contiguous prior weeks whose final schedule games all have reconciled team statistics. Stop at the first missing or incomplete week; a later completed week cannot silently bridge the gap.

**Why:** A partial current week may contain some final games, but showing those as if the whole week or season-to-date window were complete misstates coverage.

**How to apply:** Compare each prior week's final-game and reconciled-stat coverage before selecting the displayed window; retain per-team valid-sample counts and state when later weeks are excluded.