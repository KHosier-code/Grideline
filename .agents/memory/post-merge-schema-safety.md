---
name: Post-merge schema safety
description: Constraints for applying database schema changes automatically after task merges.
---

Post-merge database reconciliation must be deterministic and non-interactive. If a schema tool requires a destructive choice, setup must fail clearly rather than skip the change or accept data loss.

**Why:** A non-TTY schema push requested table truncation while adding a unique constraint, then surfaced the failed interaction as successful setup. Existing player-stat data must not be truncated.

**How to apply:** Prefer explicit, data-preserving migrations for merge reconciliation. Treat prompts, unapplied changes, and uncertain exit states as failures.