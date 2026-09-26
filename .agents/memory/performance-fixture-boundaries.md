---
name: Performance fixture route boundaries
description: How separately built performance entries behave when navigation reaches ordinary app routes
---

An SPA link from a separately built test entry changes the URL but leaves the test entry mounted. A route boundary assertion against the ordinary app requires a full document load after the timed navigation.

**Why:** A saved-games access check initially timed out even though the link reached the correct URL; it was still rendering the fixture's Home component, not the ordinary app.

**How to apply:** Measure the fixture interaction before reloading, and report the reload/access check separately so neither is mislabeled as authenticated interaction timing.