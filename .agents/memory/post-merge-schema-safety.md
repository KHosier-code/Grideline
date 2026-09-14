---
name: Post-merge schema safety
description: Constraints for applying database schema changes automatically after task merges.
---

Post-merge database reconciliation must be deterministic and non-interactive. If a schema tool requires a destructive choice, setup must fail clearly rather than skip the change or accept data loss.

**Why:** A non-TTY schema push requested table truncation while adding a unique constraint, then surfaced the failed interaction as successful setup. Existing player-stat data must not be truncated.

**How to apply:** Prefer explicit, data-preserving migrations for merge reconciliation. Treat prompts, unapplied changes, and uncertain exit states as failures.

Schema baselines must verify non-column objects that carry safety guarantees, including append-only triggers. A table and its columns are not a valid baseline when its mutation guard is absent.

**Why:** Schema-driven creation can make a migration appear structurally present even though an immutability trigger was never installed.

**How to apply:** Extend migration requirement extraction and baseline checks whenever a migration depends on triggers, policies, functions, or other database objects beyond tables, columns, indexes, and constraints.