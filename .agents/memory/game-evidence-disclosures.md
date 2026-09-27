---
name: Game evidence disclosure lifecycle
description: Why hidden Game Detail evidence mounts only after first open and remains mounted after collapse.
---

Keep disclosure contents unmounted until first opened, but retain them after collapse.

**Why:** Native HTML details hides children visually without stopping React effects or query hooks. Unmounting every time a panel closes avoids work but discards local selections and causes unnecessary cold loading on reopen. Retaining the mounted panel lets the existing query-cache stale-time and focus behavior continue without delaying visible projection, warning, or market status.

**How to apply:** For future evidence panels, preserve the distinction between first-view deferral and post-open freshness. A change to pause closed-panel refreshes should explicitly refetch stale cached data when reopened rather than replacing it with blank content. In speed checks, record cold-load timing before opening a disclosure, then open it to verify unavailable/chart states before navigating away; a closed panel has no rendered status to assert.