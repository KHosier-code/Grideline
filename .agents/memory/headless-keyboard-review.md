---
name: Headless keyboard review
description: Native keyboard activation in CDP-only browser checks
---

In a CDP-only browser check, a focused button receiving keydown does not prove its native click fired. Deliver the key's text/char event as well as keydown/up, activate the page target first, and assert the resulting UI state after rendering.

**Why:** Headless input can reach a focused element without invoking native activation, and immediate reads can observe the prior render.

**How to apply:** Use this only for CDP input checks; prefer standard browser-test APIs when available.