---
name: Recharts null-series assertions
description: Browser regression assertions for missing chart values.
---

An all-null Recharts line series can still have an SVG line node. Do not use line-element counts to prove missing values were not converted to zero; inspect plotted marks (and the displayed values) instead.

**Why:** A browser fixture showed that an all-null point series rendered a line element but no point marks. Counting lines falsely classified correct missing-data handling as a failure.

**How to apply:** For browser checks of nullable chart series, assert the null series has no plotted dots while the supported price series has dots, and verify unavailable summaries do not show fabricated numeric values.