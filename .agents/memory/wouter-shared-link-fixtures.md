---
name: Wouter shared-link browser fixtures
description: Avoid URL-change races when testing cold shared links in the browser.
---

For cold shared-link tests, navigate directly to the link and gate asynchronous evidence requests before reloading. Do not change a mounted page's URL with `history.replaceState` immediately before reload: Wouter reacts to the history change and may start requests or canonicalize the URL against already-loaded data before the reload begins.

**Why:** A pending-schedule fixture initially observed a valid game usage request and lost an invalid game URL before its delayed response was released, because the mounted page processed the history change.

**How to apply:** For reload validation tests, hold the first and reloaded evidence responses, assert the pending UI and absence of dependent requests, then release the evidence and assert the resulting URL and API parameters.