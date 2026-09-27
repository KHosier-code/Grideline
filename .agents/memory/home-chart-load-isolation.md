---
name: Home chart-load isolation
description: How to check that unsupported Home evidence does not download charts
---

When checking that Home avoids chart downloads without verified evidence, keep other routes in the browser harness lazy and inspect requests on a fresh Home navigation. Gate chart loading with the same finite-value, category and assessment rule used to select plotted metrics, not merely the game cutoff or board status.

**Why:** A statically imported Game Detail chart can appear in Home's resource list even when Home never requests it. A pre-kickoff-safe board can also contain zero supported values, so chronology alone does not justify downloading the comparison component.

**How to apply:** For future no-download regressions, isolate unrelated route imports before asserting resource entries; separately confirm that a supported board does load the plot.