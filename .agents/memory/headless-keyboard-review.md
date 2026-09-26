---
name: Headless keyboard review
description: Reliable keyboard interaction checks in a separately launched headless Chromium page
---

When sending keyboard events through Chrome DevTools Protocol to a page opened in a headless browser, bring that page to the foreground before dispatching the key event. After an input or DOM click, wait briefly for React to render before reading `aria-expanded` or finding a newly mounted link.

**Why:** A focused button in a non-frontmost DevTools target did not respond to dispatched keys, and an immediate read after a click saw the previous DOM state. Bringing the page forward and waiting for the render produced the expected accessible disclosure and link.

**How to apply:** Use this only for development-only headless CDP interaction verification where the screenshot tool cannot click. Prefer a normal test harness when available.