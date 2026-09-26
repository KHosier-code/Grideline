---
name: Consumer TSX test runtime
description: Running the consumer's TSX presentation tests outside Vite
---

For direct Node presentation tests, bundle TSX with the automatic JSX runtime rather than relying on the web app's TypeScript config, which preserves JSX for Vite. Plain TSX execution can otherwise fail with `React is not defined`.

**Why:** A direct TSX test attempted to execute preserved JSX with the classic runtime. After bundling, server-rendering a Home card failed because its Wouter link's location hook did not provide a server snapshot in this setup.

**How to apply:** When adding lightweight non-browser presentation tests, use a JSX-transforming runner or bundle with automatic JSX. For components containing Wouter links, wrap server rendering in a Router with a pure static location hook that returns a path and no-op navigator. Wouter's browser hook requires location, while its memory hook lacks the server snapshot required by React's server renderer. Use a browser-capable test only if interaction itself is essential.