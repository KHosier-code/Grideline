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

Migration history can outlive a branch rollback. Restore missing, byte-identical migration files from repository history when their checksums match the development ledger; do not delete ledger entries or teach post-merge setup to ignore unknown migrations.

**Why:** A restored code checkpoint omitted later migration files while the development database still recorded them. Strict reconciliation correctly stopped the next merge even though the newly merged task itself did not change those migrations.

**How to apply:** Compare every unknown ledger name and checksum against historical source blobs before restoring them. Keep the runner's unknown-name and checksum checks intact, then rerun the normal post-merge setup.

An applied ledger entry does not prove a table survived a partial development reset. For immutable evidence, recover only independently verifiable missing objects; do not replay an entire execute-once migration against a partly intact schema.

**Why:** Replaying table creation alongside an existing immutable trigger can conflict, while trusting the ledger alone leaves the API querying a missing weekly selection table. Broad current-schema pushes against empty databases can also collide with historical migration constraints.

**How to apply:** Check the surviving parent and guard before any targeted repair, preserve existing rows, and fail clearly if base schema is absent rather than forcing a broad schema push.