---
name: Unchanged player fetches
description: Distinguishing successful full provider observations from change-only player snapshot writes.
---

A complete successful player-provider fetch can establish current observation freshness even when no individual player has changed. A changed-row snapshot timestamp alone cannot represent the last observation.

**Why:** Change-only history intentionally does not write duplicate rows. Using its newest row as the sole freshness signal makes a healthy unchanged feed appear stale. Conversely, a success label without a complete, nonempty provider response must not refresh evidence.

**How to apply:** Use recorded full-response count and capture time from a successful run when assessing source freshness; keep failed, empty, and chronologically invalid runs from advancing it. Continue using actual changed-row history for player state and movement.