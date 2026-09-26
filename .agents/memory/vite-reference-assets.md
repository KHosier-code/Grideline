---
name: Vite reference assets
description: Why reference-only imagery must live outside the frontend app root
---

Keep reference-only artwork that must not be downloadable outside the Vite application's root, not merely outside its `public` directory.

**Why:** A production build copies `public` assets but excludes other root files, while the Vite development server can serve a non-public image placed elsewhere under the app root by its normal URL. A build-only check misses that preview exposure.

**How to apply:** When archiving inspiration images containing fake product content, place them in repository-level documentation and verify both the production output and development response content type. A development SPA fallback may respond 200 to the old image URL but return HTML, not image bytes.