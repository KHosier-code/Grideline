---
name: Public metadata boundary
description: Why Gridline public share metadata must be verified before client rendering
---

Public game share previews should name teams only after the public game lookup verifies the identity. Missing or temporarily unverifiable IDs must not inherit a generic indexable game title; they fail closed with noindex. Stable public pages can have fixed metadata, but a client-side head update is insufficient for social unfurlers.

**Why:** The original static SPA shell sent identical head tags to all direct requests, including private routes and nonexistent games. Social crawlers usually do not execute the client, and the schedule and projection evidence can be absent even for real games.

**How to apply:** If changing hosting, caching, or share routing, check the raw HTML response for a real game, a missing ID, an API outage and a private route. Keep the public page copy agnostic to dynamic performance and forecast readiness until the actual source provides it.