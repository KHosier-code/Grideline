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

For Team Evidence's default cutoff, distinguish "every final game has paired statistics" from "every scheduled game is final and has paired statistics." Discover readiness through the season, then render a separate response ending at the contiguous verified cutoff; do not treat discovery data as displayed chart data.

**Why:** An in-progress week can have perfectly matched statistics for its one final game while many more scheduled games have not finished. Reusing its discovery response updates charts early and reports an expected partial-week warning.

**How to apply:** Keep the week selector, plotted observations and coverage list on the same verified response. A missing schedule week or delayed paired statistics blocks advancing; do not suppress genuine evidence warnings just because the current week is unfinished.

Treat a persisted week's own game count as insufficient proof of schedule completeness. Compare matchup identities with a fresh provider fixture independently of persisted games; if the fixture is missing or the identities differ, keep the cutoff before that week.

**Why:** A week with a missing persisted matchup can still have every *recorded* game final and statistically covered, so count-based final/stat checks would advance falsely.

**How to apply:** Fail closed when provider coverage cannot be verified; preserve the distinction between an absent provider fixture and a confirmed missing persisted matchup. Do not fabricate scores or statistics to close either gap.