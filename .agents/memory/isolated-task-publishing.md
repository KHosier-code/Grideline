---
name: Isolated task publishing boundary
description: Why publishing during an in-progress task does not deploy its isolated code changes.
---

An in-progress project task runs in an isolated copy; the main project's Publish action builds main, not the task copy. A successful publication is not proof that a task's changes reached production.

**Why:** A publication during an isolated task succeeded but served an older main-project build, leaving a newly added endpoint unavailable. A production import depending on that endpoint could not safely proceed.

**How to apply:** For production-dependent task work, distinguish task-preview validation from published behavior. The user must apply the ready task to main and republish before confirming the deployed source and running any approval-gated production action. If that lifecycle prevents completing the production step in the same task, explicitly hand it off rather than claiming repair.