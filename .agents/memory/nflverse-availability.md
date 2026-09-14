---
name: NFLverse availability semantics
description: How to distinguish successful downloads from usable season coverage and handle depth-chart format changes.
---

Treat a downloaded dataset as successful only when it contains usable rows for the requested season. A combined release file can download and parse correctly while ending before the requested season.

**Why:** The combined player-stat archive was valid but did not contain the newest requested seasons. Counting its raw rows produced a false success until season-filtered rows were validated.

**How to apply:** Preserve the source limitation as a failed or unavailable season entry with a clear message. Do not generate missing rows or carry older values forward.

Historical depth-chart releases use weekly season rows in older files and timestamped snapshot rows in newer files. Preserve the source timestamp in the newer format and use a stable source key to deduplicate exact snapshots.

**Why:** Batch inserts exposed duplicate natural keys, and newer depth files changed columns rather than following the weekly schema.

**How to apply:** Detect the format from headers, normalize both variants, deduplicate within each batch, and retain the original snapshot timestamp when present.