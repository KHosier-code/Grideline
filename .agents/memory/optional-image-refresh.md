---
name: Optional image refresh
description: Keep remote visual enrichment independent from essential consumer response latency and measure cold reads.
---

Optional third-party images may be displayed only when verified evidence exists, but fetching that evidence must never hold core consumer data responses. On cold cache or expiry, return existing verified images or explicit null placeholders immediately, and refresh remotely with bounded retries in the background.

**Why:** A source refresh introduced alongside route splitting could wait for two remote CSV downloads before sending Home, Games, or Game Detail data. A browser benchmark that fetched the dashboard before timing routes warmed the cache and concealed this slow path.

**How to apply:** For optional enrichment, test a pending/failed source request and a cold-process route separately. Do not interpret warm-cache route timings as proof of cold-start readiness. Admin source reports may explicitly await fresh evidence, but fan-facing essentials should not.