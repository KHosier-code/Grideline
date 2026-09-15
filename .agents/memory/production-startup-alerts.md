---
name: Production startup alerts
description: Approved channel and data-handling rule for production startup-gate failures.
---

Use Replit App Monitoring email as the operator notification channel for
production startup-gate failures. Let the failed process remain unavailable so
the platform health monitor detects it, and emit a stable failure category in
deployment logs for triage.

**Why:** The user approved Replit App Monitoring email instead of adding an
external webhook. Platform monitoring also owns repeated-downtime notification
rate limiting across process restarts.

**How to apply:** Startup alert events must contain only explicitly allow-listed
operational metadata. Never include raw errors, database URLs, credentials,
database hosts, or connection details.