---
name: Unchanged player fetches
description: Distinguishing successful full provider observations from change-only player snapshot writes.
---

A complete successful player-provider fetch can establish current observation freshness even when no individual player has changed. A changed-row snapshot timestamp alone cannot represent the last observation.

**Why:** Change-only history intentionally does not write duplicate rows. Using its newest row as the sole freshness signal makes a healthy unchanged feed appear stale. Conversely, a success label without a complete, nonempty provider response must not refresh evidence.

**How to apply:** Use recorded full-response count and capture time from a successful run when assessing source freshness; keep failed, empty, and chronologically invalid runs from advancing it. Continue using actual changed-row history for player state and movement.

An injury-only feed is not a full roster observation, even when its player rows also update a shared player table. Omitted players are not proven healthy, and a valid Sleeper full retrieval cannot independently verify ESPN player/team assignments.

**Why:** The availability endpoint can update player rows only for injured players whose entries change; treating those timestamps or an unrelated provider's full fetch as roster confirmation would silently authorize forecasts without current team evidence.

**How to apply:** Require independently evidenced, per-player/current-team roster coverage before positive eligibility, and count only fresh explicit matching availability and starter observations. Retain changed-row history and source-retrieval chronology separately.