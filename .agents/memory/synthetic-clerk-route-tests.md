---
name: Synthetic Clerk route tests
description: In-process Express route tests with Clerk auth objects
---

An in-process request auth function must carry an accepted session token type as well as Clerk's request-auth marker when testing protected Express routes. A marker plus user ID without the token type can be converted to signed-out by Clerk's `getAuth` even though the request reaches the route.

**Why:** A disposable database route test initially returned 401 for a simulated signed-in member; the token acceptance layer discarded an otherwise recognizable synthetic auth object.

**How to apply:** When using synthetic auth in isolated HTTP route tests, verify both anonymous and member rejection and successful admin authorization; do not treat a branded function by itself as proof that `getAuth` will return its user ID. This is test-only behavior, not a production authentication shortcut.