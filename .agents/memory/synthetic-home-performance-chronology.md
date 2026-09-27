---
name: Synthetic Home performance chronology
description: Why fixed synthetic pregame Home workloads need two different time boundaries.
---

For synthetic Home speed workloads, keep scheduled kickoffs in the future relative to the actual browser clock, while putting pregame evidence cutoffs in the past relative to that clock and before kickoff.

**Why:** The real Home component independently checks both that the game remains upcoming and that the matchup-board cutoff has already occurred. A far-future fixed cutoff silently withholds the comparison chart even when the fixture returns valid numeric assessments. Overriding browser time to repair this could distort the measured work.

**How to apply:** When revising fixed fixtures, verify both comparisons against the runner's real time; assert that the chart actually renders, rather than only checking the weekly heading or API payload.