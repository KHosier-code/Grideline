---
name: Bundled API test resolution
description: Why direct standalone test bundles may fail in this pnpm workspace
---

Use the API server's own build pipeline for Node tests importing workspace TypeScript packages, rather than independently bundling those tests with external package resolution.

**Why:** Independently emitted test files outside the package could not resolve its installed dependencies; even inside the package, external resolution reached extensionless workspace TypeScript imports that Node could not load. The server build produces runnable bundled tests.

**How to apply:** When a focused API test has workspace imports, let the configured server build generate the test output and run that output with Node. Keep isolated test scripts only for tests with independently resolvable dependencies.