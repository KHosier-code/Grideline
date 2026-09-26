---
name: NFLverse availability semantics
description: How to distinguish successful downloads from usable season coverage and handle depth-chart format changes.
---

Treat a downloaded dataset as successful only when it contains usable rows for the requested season. A combined release file can download and parse correctly while ending before the requested season.

**Why:** The combined player-stat archive was valid but did not contain the newest requested seasons. Counting its raw rows produced a false success until season-filtered rows were validated.

**How to apply:** Preserve the source limitation as a failed or unavailable season entry with a clear message. Do not generate missing rows or carry older values forward.

A successful source ledger entry or a newer upstream Last-Modified header does not establish coverage for a specific completed week. Confirm the file's season/week and distinct-game rows before claiming that week is available; distinguish a stale local cache from an unpublished upstream week.

**Why:** A development cache remained at Week 1 after the worker missed its normal occurrence, while the public release had since gained every Week 2 game. Neither the old successful ledger nor a newer HEAD timestamp alone proved the present week's contents.

**How to apply:** For release reviews, inspect a separate public source copy without replacing the application cache or triggering a scheduled import. Report source availability, local import coverage, and derived-fact coverage separately.

When the current-season file is valid but contains no usable rows for that season, avoid repeated large downloads within the same scheduled slot. Retry on the next normal slot, when the publisher may have updated the release; ordinary transient failures retain bounded backoff.

**Why:** Repeated downloads of the same current-season archive cannot manufacture missing season rows and unnecessarily consume bandwidth and worker time.

**How to apply:** Keep the original failed attempt visible, distinguish this source-availability failure from network errors, and do not disable future scheduled slots.

Historical depth-chart releases use weekly season rows in older files and timestamped snapshot rows in newer files. Preserve the source timestamp in the newer format and use a stable source key to deduplicate exact snapshots.

**Why:** Batch inserts exposed duplicate natural keys, and newer depth files changed columns rather than following the weekly schema.

**How to apply:** Detect the format from headers, normalize both variants, deduplicate within each batch, and retain the original snapshot timestamp when present.

The nflverse players release uses `latest_team`, not `team`, for its current team field. Version parser semantics independently from raw-file hashes so corrected column interpretation creates new immutable evidence instead of rewriting an old import.

**Why:** A byte-identical players file initially parsed with the wrong team header, preventing safe name/team/position corroboration while the raw source hash still appeared unchanged.

**How to apply:** Validate identity-critical headers, include a parser version in import uniqueness/provenance, and append a new import revision whenever parsing semantics change.