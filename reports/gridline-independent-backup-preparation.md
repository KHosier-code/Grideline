# Gridline independent production backup — preparation only

**Status: BACKUP NOT YET VERIFIED.** No production credential was accessed, no dump was executed, no restore was attempted, and no production data, worker, binding, or deployment was changed by this preparation.

## Phase 1 evidence and unresolved prerequisites

- The available `pg_dump` and `pg_restore` clients are PostgreSQL **16.10**. Replit's managed production read-only query reports `neondb`, role `neondb_owner`, PostgreSQL **16.15**, and approximately **660 MB** of logical database storage. The client and server have the same major version. This read-only query is not access to the production connection credential.
- The latest production release-evidence build ID is **`7b057630d4a8-2026-09-26T02:31:27.142Z`**; the same ID appears in live deployment logs. This is newer than the previously recorded production build. Recheck it against live logs immediately before any approved dump and fail closed if it changes. A matching name or version alone is not enough to identify Gridline's live database.
- [Replit documents](https://docs.replit.com/features/data-and-storage/connection-details#connect-an-external-tool) a production connection string in **Database → Production Database → Settings**, usable by an external PostgreSQL client. It does **not** document a separate externally usable read-only credential or replica endpoint. The Agent's read-only production query interface cannot stream a full `pg_dump` archive. Do not confuse the development shell's `DATABASE_URL` with the production credential.
- [PostgreSQL documents](https://www.postgresql.org/docs/16/app-pgdump.html) that `pg_dump` creates a consistent export without blocking ordinary readers or writers. It still consumes production read I/O and can conflict with schema DDL; a short lock wait limit should fail rather than stall. A client-side read-only session is possible even if the only available credential itself is write-capable, but **this is not a database-enforced read-only role**.
- Proposed credential method: an owner-controlled, trusted **external Linux backup host** uses a private libpq service file (`PGSERVICEFILE`) for non-secret connection settings and a private password file (`PGPASSFILE`) for the production password. Both have mode `0600`, never enter this project, shell history, command arguments, logs, or chat. The operator must configure them from the **Production** Settings UI after explicitly authorizing credential access. Do not copy production credentials into a Replit development variable or replace `DATABASE_URL`.
- **Destination is not yet identified or verified.** Propose an encrypted owner-controlled folder on that external host, with access restricted to backup operators and at least **3 GiB free** for the archive and diagnostics (planning margin, not a bound on compressed size). An independent disposable restore target needs its own capacity. The owner must identify the host/folder class and confirm encryption, access restrictions, and capacity before execution.

## Exact proposed Phase 2 commands — for review, NOT executed

Run only on the approved external Linux host, after separate authorization and secure configuration of `gridline-prod-backup` in the libpq service file. Replace the private paths with owner-approved paths. The password file and service file are not part of the project. Do not paste their contents into chat. This script refuses a mismatched database, PostgreSQL major, read-only session, or currently observed live build ID before dumping.

```bash
set -euo pipefail
umask 077
export PGSERVICEFILE="$HOME/.config/gridline/prod-backup.pg_service.conf"
export PGPASSFILE="$HOME/.config/gridline/prod-backup.pgpass"
export PGOPTIONS='-c default_transaction_read_only=on'
export PGCONNECT_TIMEOUT=10
BACKUP_DIR="/owner-approved/encrypted/gridline"
EXPECTED_BUILD_ID="7b057630d4a8-2026-09-26T02:31:27.142Z"

test -d "$BACKUP_DIR" && test -w "$BACKUP_DIR"
test "$(stat -c '%a' "$PGSERVICEFILE")" = 600
test "$(stat -c '%a' "$PGPASSFILE")" = 600
free_kib="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
test "$free_kib" -ge 3145728

identity="$(psql -XAt -v ON_ERROR_STOP=1 -F '|' --dbname='service=gridline-prod-backup' -c \
  "SELECT current_database(), current_user, current_setting('server_version_num'),
          current_setting('default_transaction_read_only'),
          (SELECT build_id FROM public.release_security_evidence
           ORDER BY checked_at DESC LIMIT 1)")"
IFS='|' read -r db_name db_role server_version read_only build_id <<< "$identity"
if [[ "$db_name" != neondb || "$server_version" != 16* ||
      "$read_only" != on || "$build_id" != "$EXPECTED_BUILD_ID" ]]; then
  printf 'Production backup identity mismatch; stopping before pg_dump\n' >&2
  exit 1
fi

archive="$BACKUP_DIR/gridline-neondb-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$archive" && test ! -e "$archive.partial"
if pg_dump --dbname='service=gridline-prod-backup' --format=custom \
    --serializable-deferrable --lock-wait-timeout=5s \
    --file="$archive.partial" 2>"$archive.stderr"; then
  dump_status=0
else
  dump_status=$?
fi
printf '%s\n' "$dump_status" > "$archive.exit-status"
test "$dump_status" -eq 0
test -s "$archive.partial"
mv -- "$archive.partial" "$archive"
date -u +%Y-%m-%dT%H:%M:%SZ > "$archive.completed-utc"
sha256sum "$archive" > "$archive.sha256"
pg_restore --list "$archive" > "$archive.toc"
sha256sum --check "$archive.sha256"
```

The role name is captured only for a later non-secret audit, not used to authorize the source. If a dedicated read-only role exists, it may differ from `neondb_owner`. A stale `EXPECTED_BUILD_ID` intentionally stops the script; refresh the baseline from read-only production evidence and live logs **before** approval and execution rather than loosening the check. The short lock wait or read-only session can make a dump fail safely. The `.stderr`, `.exit-status`, timestamp, checksum, and archive listing remain in the private destination.

An archive listing and checksum establish only preliminary integrity; they **do not** prove that the backup restores. After **separate authorization to restore anywhere**, restore into a newly provisioned disposable database outside production and compare the schema, table/index inventory, game history, model and promotion metadata, prediction snapshots, recent legitimate records, and artifact checksums. `pg_dump` is a logical database snapshot; it does not automatically protect external model artifacts, cluster-wide roles/settings, or writes made after completion. Preserve subsequent legitimate writes separately and reconcile them during any later recovery.

**Do not proceed to Phase 2 or Phase 3 until the owner has confirmed the private destination and given explicit authorization for credential access, backup execution, and the isolated restore.**

BACKUP NOT YET VERIFIED