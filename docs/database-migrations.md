# Database migration safety

Development schema changes are applied by the deterministic, non-interactive
runner at `lib/db/src/migrate.ts`. `scripts/post-merge.sh` invokes it only with
`GRIDLINE_MIGRATION_ENV=development`. It reads migrations in filename order,
uses one transaction per migration, records SHA-256 checksums in
`gridline_migration_history`, takes a PostgreSQL advisory lock, and rejects
`TRUNCATE` and `DROP TABLE`. A pre-ledger development schema is recorded only
as an explicitly labelled `baseline` after its tables, columns, indexes, and
constraints are verified. A checksum mismatch or unknown ledger migration
fails closed.

Production is not a target of this runner. Before a production schema change,
the operator must use the Replit Publish flow's backup/checkpoint and review
process. Replit Publish owns production schema diffing and application; this
project must never use custom DDL, a deploy-time schema push, or a startup
migration against production.