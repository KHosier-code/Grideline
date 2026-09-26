# Gridline independent production backup — owner-run procedure

## Report sections

- Phase 1: Windows client, credential, BitLocker folder, and ACL preparation.
- Phase 2: guarded owner-run PowerShell backup, including production identity and TLS checks.
- Backup checks: dump status, UTC timestamp, SHA-256, and archive listing.
- Phase 3: isolated Windows restore procedure, **not authorized** without separate approval.
- Phase 4: evidence to record after an owner-run backup and any separately approved restore.

**Status: BACKUP NOT YET VERIFIED.** No production credential was accessed, no dump was executed, no restore was attempted, and no production data, worker, binding, or deployment was changed by this preparation.

**Authorization boundary:** The owner authorized **one** independent, read-only logical backup using the standard production credential, while acknowledging that the credential itself may have write privileges. Authorization is conditional on local verification of the BitLocker destination, restricted ACLs, exact commands, and live production database identity. **The owner will run the reviewed commands on their own Windows computer; the Agent must not run a production dump from Replit.** Restoring data anywhere, publishing, migrations, worker restarts, provider synchronization, and production writes are **not authorized**. No archive or password file belongs in this project or Git.

## Phase 1 evidence and unresolved prerequisites

- The Replit-workspace `pg_dump` and `pg_restore` clients are PostgreSQL **16.10**. Replit's managed production read-only query reports `neondb`, role `neondb_owner`, PostgreSQL **16.15**, and approximately **660 MB** of logical database storage. **The owner confirms `pg_dump`, `pg_restore`, and `psql` are all installed and working at version 16.15 on the BitLocker-protected Windows computer.** Client/server major compatibility is established; a connection from that computer has not been tested. The read-only production metadata query did not access a production credential.
- The latest production release-evidence build ID is **`7b057630d4a8-2026-09-26T02:31:27.142Z`**; the same ID appears in live deployment logs. This is newer than the previously recorded production build. Recheck it against live logs immediately before any approved dump and fail closed if it changes. A matching name or version alone is not enough to identify Gridline's live database.
- [Replit documents](https://docs.replit.com/features/data-and-storage/connection-details#connect-an-external-tool) a production connection string in **Database → Production Database → Settings**, usable by an external PostgreSQL client. **The owner inspected those Settings and reports that only the standard production `DATABASE_URL` and its individual variables are visible; no separate read-only or replica connection is shown.** The documentation does not describe one either. This establishes what is visible in Settings, not that no restricted access could ever be provisioned by other means. The Agent's read-only production query interface cannot stream a full `pg_dump` archive. Do not confuse the development shell's `DATABASE_URL` with the production credential.
- [PostgreSQL documents](https://www.postgresql.org/docs/16/app-pgdump.html) that `pg_dump` creates a consistent export without blocking ordinary readers or writers. It still consumes production read I/O and can conflict with schema DDL; a short lock wait limit should fail rather than stall. A client-side read-only session is possible even if the only available credential itself is write-capable, but **this is not a database-enforced read-only role**.
- Proposed credential method: the owner uses a private libpq service file (`PGSERVICEFILE`) for connection settings and a private password file (`PGPASSFILE`) **on the BitLocker-protected Windows computer**, in a restricted credentials folder **separate from the archive destination**. The service must require certificate-verified TLS (for example `sslmode=verify-full` with an appropriate trust root), never disabled TLS. PostgreSQL documents both [service files](https://www.postgresql.org/docs/16/libpq-pgservice.html) and [password files](https://www.postgresql.org/docs/16/libpq-pgpass.html) on Windows. The password must never enter this project, backup archive folder, shell history, command arguments, logs, or chat. The owner would configure these files from the **Production** Settings UI only **after** separately authorizing credential access. Do not copy production credentials into Replit development variables or replace `DATABASE_URL`. **Because no read-only connection is visible, treat the standard credential as write-capable** unless its privileges are separately proven restricted. The proposed client session defaults to read-only, but that is not a database-enforced restriction on the credential.
- **Destination owner-confirmed, not independently inspected:** a private, BitLocker-encrypted Windows computer outside Replit, with **at least 3 GiB free** and access restricted to authorized operators. The exact encrypted drive/folder and ACLs still need local verification before execution; an independent disposable restore target needs its own capacity.

## Phase 2: reviewed Windows backup procedure — authorized conditionally, NOT executed

1. The owner has **already authorized one backup** with the standard potentially write-capable production credential, conditional on the checks below. Production Database → Settings shows no separate read-only or replica connection. Creating a restricted role would itself change production and is **not** authorized. The only database operations in the commands below are a `SELECT` preflight and `pg_dump`'s read-only snapshot. Do not publish, run the application or worker, or synchronize providers as part of this procedure.
2. On the Windows computer, choose an existing private folder on the confirmed BitLocker-protected drive for the archive (example `X:\Private\Gridline`) and a **different restricted folder** on that drive for the credential files (example `X:\Private\PgCredentials`). Verify the drive has at least 3 GiB free, BitLocker protection is on, and Windows ACLs allow only authorized operators to read either folder. Review folder and credential-file ACLs below: stop if `Everyone`, general `Users`, `Authenticated Users`, or another unapproved principal can read either folder or file, including through inherited permissions. An operator account, local Administrators and SYSTEM may be appropriate only if the owner approves their access. Do not run the dump merely because `Get-Acl` returned results; **inspect them**. These `X:` paths are **examples, not an identified drive or permission grant**. The local computer and capacity are owner-attested; they have not been remotely inspected.
3. After the conditional destination and ACL checks, the owner transcribes the *production*, not development, host, port, database and user from the Production Settings connection into the private libpq service file. Use a service named `gridline-prod-backup` with certificate-verified TLS (`sslmode=verify-full`, plus a trusted CA path if needed). Its format is shown below; the values are **placeholders**, not actual connection details. Put the password in the separate libpq password file using PostgreSQL's `host:port:database:user:password` format; escape colons and backslashes as PostgreSQL documents. Restrict both files' ACLs to the operator and review them locally, for example with the **read-only** PowerShell commands below. Never paste a URL/password into chat or a PowerShell command, transcript, repository, backup folder, or Replit secret. The service file contains no password. If certificate verification fails, stop rather than weakening TLS.

   ```ini
   [gridline-prod-backup]
   host=PRODUCTION_HOST_FROM_SETTINGS
   port=PRODUCTION_PORT_FROM_SETTINGS
   dbname=neondb
   user=PRODUCTION_USER_FROM_SETTINGS
   sslmode=verify-full
   ```

   ```powershell
   # Run locally after files exist; inspect for unexpected inherited or broad access.
   Get-Acl -LiteralPath 'X:\Private\Gridline' | Select-Object -ExpandProperty Access
   Get-Acl -LiteralPath 'X:\Private\PgCredentials' | Select-Object -ExpandProperty Access
   Get-Acl -LiteralPath 'X:\Private\PgCredentials\prod-backup.pg_service.conf' |
     Select-Object -ExpandProperty Access
   Get-Acl -LiteralPath 'X:\Private\PgCredentials\prod-backup.pgpass' |
     Select-Object -ExpandProperty Access
   ```

   If the private folders or restricted ACLs are not already configured, set them up locally with an administrator before entering the password. Do **not** copy the credential files along with the archive.
4. The dump runs **directly from the production database to the owner's encrypted Windows folder over certificate-verified TLS**. No copy or staging step in Replit is needed or permitted. Recheck the latest production build ID against live deployment logs just before the approved run; if it differs from the frozen `$ExpectedBuildId` below, **stop and review the new baseline**. Do not update the value simply to make the script pass. Run the PowerShell block **once only**, after the destination, credential files, exact command text, and baseline have been reviewed. Close this PowerShell session after success or failure to clear its connection-file environment variables. Keep the resulting archive, status, timestamp, checksum and listing private. An archive listing is **not** a restore test.

Run only on the owner's approved **Windows** computer, in a fresh PowerShell window, using the verified PostgreSQL 16.15 client tools. Replace all `X:` paths with verified BitLocker-protected folders; keep service and password files on the protected volume but outside the archive folder. Inspect ACLs on the folder and files first. The service file's `gridline-prod-backup` section must refer to the production Settings connection, not development. Do not paste its contents into chat. The script refuses a mismatched database, PostgreSQL major, read-only session, TLS state, or reviewed live build ID before dumping. If any guard fails, **stop; do not disable or bypass it**.

```powershell
$ErrorActionPreference = 'Stop'
$BackupDir = 'X:\Private\Gridline' # OWNER REPLACES with a confirmed encrypted local folder
$ExpectedBuildId = '7b057630d4a8-2026-09-26T02:31:27.142Z'
$Service = 'service=gridline-prod-backup'
$env:PGSERVICEFILE = 'X:\Private\PgCredentials\prod-backup.pg_service.conf'
$env:PGPASSFILE = 'X:\Private\PgCredentials\prod-backup.pgpass'
$env:PGOPTIONS = '-c default_transaction_read_only=on'
$env:PGCONNECT_TIMEOUT = '10'
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

foreach ($tool in @('pg_dump.exe', 'pg_restore.exe', 'psql.exe')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is missing" }
}
foreach ($tool in @('pg_dump.exe', 'pg_restore.exe', 'psql.exe')) {
  $version = & $tool --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch 'PostgreSQL\) 16\.') {
    throw "PostgreSQL 16 client required: $tool"
  }
}
if (-not (Test-Path -LiteralPath $BackupDir -PathType Container) -or
    -not (Test-Path -LiteralPath $env:PGSERVICEFILE -PathType Leaf) -or
    -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) {
  throw 'The approved folder, service file, or private password file is missing'
}
$drive = [IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $BackupDir).Path).Substring(0,1)
foreach ($path in @($env:PGSERVICEFILE, $env:PGPASSFILE)) {
  if ([IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $path).Path).Substring(0,1) -ne $drive) {
    throw 'Credential files must remain on the same BitLocker-protected volume'
  }
}
if ((Get-BitLockerVolume -MountPoint "$($drive):").ProtectionStatus -ne 'On') {
  throw 'Backup destination is not BitLocker-protected'
}
if ((Get-Volume -DriveLetter $drive).SizeRemaining -lt 3GB) {
  throw 'Backup destination has less than 3 GiB free'
}

$sql = "SELECT current_database(), current_user, current_setting('server_version_num'), " +
       "current_setting('default_transaction_read_only'), " +
       "(SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()), " +
       "(SELECT build_id FROM public.release_security_evidence ORDER BY checked_at DESC LIMIT 1)"
$identity = & psql.exe -X -A -t -F '|' -v ON_ERROR_STOP=1 "--dbname=$Service" --command=$sql
if ($LASTEXITCODE -ne 0) { throw 'Production identity preflight failed' }
$fields = (($identity | Where-Object { $_ -match '\|' } | Select-Object -Last 1) -split '\|', 6)
if ($fields.Count -ne 6 -or $fields[0] -ne 'neondb' -or
    $fields[2] -notmatch '^16\d{4}$' -or $fields[3] -ne 'on' -or
    $fields[4] -notin @('t', 'true') -or $fields[5] -ne $ExpectedBuildId) {
  throw 'Production identity mismatch; no dump was attempted'
}

$archive = Join-Path $BackupDir ("gridline-neondb-{0:yyyyMMddTHHmmssZ}.dump" -f [DateTime]::UtcNow)
$partial = "$archive.partial"
if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $partial)) {
  throw 'Archive filename already exists'
}
$attemptMarker = Join-Path $BackupDir 'gridline-production-backup-attempted.flag'
if (Test-Path -LiteralPath $attemptMarker) {
  throw 'One backup attempt has already been recorded here; stop for review'
}
[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ') |
  Set-Content -LiteralPath $attemptMarker -Encoding Ascii
$ErrorActionPreference = 'Continue' # preserve native stderr and capture pg_dump exit status
& pg_dump.exe "--dbname=$Service" --format=custom --serializable-deferrable `
  --lock-wait-timeout=5s "--file=$partial" 2> "$archive.stderr"
$dumpStatus = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Set-Content -LiteralPath "$archive.exit-status" -Value $dumpStatus -Encoding Ascii
if ($dumpStatus -ne 0 -or (Get-Item -LiteralPath $partial).Length -eq 0) {
  throw 'Dump failed or produced an empty file; do not use the partial archive'
}
Move-Item -LiteralPath $partial -Destination $archive
[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ') |
  Set-Content -LiteralPath "$archive.completed-utc" -Encoding Ascii
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($archive))" |
  Set-Content -LiteralPath "$archive.sha256" -Encoding Ascii
& pg_restore.exe --list $archive > "$archive.toc"
if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath "$archive.toc").Length -eq 0) {
  throw 'Archive listing failed; backup is not verified'
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $hash) {
  throw 'Archive checksum changed; backup is not verified'
}
@(
  "source_database=$($fields[0])"
  "source_role=$($fields[1])"
  "source_build_id=$($fields[5])"
  "archive_bytes=$((Get-Item -LiteralPath $archive).Length)"
  "sha256=$hash"
  "dump_exit_status=$dumpStatus"
  "completed_utc=$(Get-Content -LiteralPath "$archive.completed-utc")"
) | Set-Content -LiteralPath "$archive.manifest" -Encoding Ascii
Write-Output "source_database=$($fields[0])"
Write-Output "source_build_id=$($fields[5])"
Write-Output "dump_exit_status=$dumpStatus"
Write-Output "completed_utc=$(Get-Content -LiteralPath "$archive.completed-utc")"
Write-Output "archive_bytes=$((Get-Item -LiteralPath $archive).Length)"
Write-Output "sha256=$hash"
Write-Output 'archive_listing=passed (not a restore test)'
```

The role name is returned by the identity query but is not used to authorize the source. No dedicated read-only connection is visible in Production Settings. A stale `$ExpectedBuildId` intentionally stops the script; verify the baseline against live logs **before** execution rather than loosening the check. The short lock wait or read-only session can make a dump fail safely, but it does not revoke write privileges from the account. The attempt marker prevents accidentally running the approved script a second time in the same folder; after a failed attempt, stop and review before retrying. The `.stderr`, `.exit-status`, timestamp, checksum, and archive listing remain in the private destination. Windows file ACL restrictions on the password file and backup folder are an explicit owner verification step; BitLocker alone does not restrict access while the computer is unlocked.

An archive listing and checksum establish only preliminary integrity; they **do not** prove that the backup restores.

## Phase 3: isolated Windows restore test — separate approval required, NOT executed

1. **Stop for a separate express authorization to restore**, even to a disposable local database. Confirm PostgreSQL 16.15 **server** tools (`initdb.exe`, `pg_ctl.exe`, `createdb.exe`) are available; the owner has confirmed the three client tools, **not** these server tools. If they are absent, stop and provision a separate isolated PostgreSQL 16 server before continuing. Do not point a restore command at Replit, the production host, a development database, or any shared server.
2. On the BitLocker Windows computer, retain the archive and manifest. Close the backup PowerShell window and open a new one **without production service/password variables**. Disconnect the machine from the network before creating or starting the local restore cluster. Keep it offline until the local server is stopped, so extensions or archived database objects cannot reach production or third parties. Do not start the Gridline API or worker on this cluster.
3. The following PowerShell plan creates a **new** PostgreSQL 16 cluster in a separate protected folder, listens **only on `127.0.0.1:55432`**, uses password authentication, asserts loopback identity, creates an empty database, and restores the archive. Replace the example `X:` paths with the approved encrypted paths. The cluster's locally prompted password is **not the production password**. If any preflight or restore exits nonzero, mark the backup **NOT VERIFIED** and investigate without touching production.

```powershell
$ErrorActionPreference = 'Stop'
$Archive = 'X:\Private\Gridline\gridline-neondb-REPLACE_WITH_ACTUAL_UTC_TIMESTAMP.dump'
$RestoreRoot = 'X:\Private\GridlineRestoreCluster' # new, disposable, not the archive folder
$RestoreUser = 'gridline_restore_admin'
$RestoreDb = 'gridline_restore_test'
$RestorePort = '55432'

# This is a NEW PowerShell window on an OFFLINE computer. No production credentials here.
Remove-Item Env:DATABASE_URL,Env:PGSERVICEFILE,Env:PGPASSFILE,Env:PGOPTIONS,`
  Env:PGPASSWORD,Env:PGHOST,Env:PGPORT,Env:PGDATABASE,Env:PGUSER `
  -ErrorAction SilentlyContinue
foreach ($tool in @('initdb.exe', 'pg_ctl.exe', 'createdb.exe', 'pg_restore.exe', 'psql.exe')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is missing" }
  $version = & $tool --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch 'PostgreSQL\) 16\.') {
    throw "PostgreSQL 16 server and client tools required: $tool"
  }
}
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf) -or
    -not (Test-Path -LiteralPath "$Archive.manifest" -PathType Leaf) -or
    -not (Test-Path -LiteralPath "$Archive.toc" -PathType Leaf) -or
    (Test-Path -LiteralPath $RestoreRoot)) {
  throw 'Archive, manifest or listing missing, or disposable cluster folder already exists'
}
$drive = [IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $Archive).Path).Substring(0,1)
if ([IO.Path]::GetPathRoot($RestoreRoot).Substring(0,1) -ne $drive -or
    (Get-BitLockerVolume -MountPoint "$($drive):").ProtectionStatus -ne 'On' -or
    (Get-Volume -DriveLetter $drive).SizeRemaining -lt 3GB) {
  throw 'Disposable restore is not on the protected volume or lacks 3 GiB free'
}
$expectedHashLine = Get-Content -LiteralPath "$Archive.manifest" |
  Where-Object { $_ -like 'sha256=*' } | Select-Object -First 1
$expectedHash = $expectedHashLine -replace '^sha256=', ''
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash
if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$' -or
    $actualHash -ne $expectedHash) {
  throw 'Archive does not match its recorded SHA-256 checksum'
}
$sourceToc = Get-Content -LiteralPath "$Archive.toc"
if ($sourceToc -match ' SUBSCRIPTION | FOREIGN SERVER | FOREIGN DATA WRAPPER | USER MAPPING | FOREIGN TABLE ') {
  throw 'Archive contains external-access objects; inspect before any restore'
}

# initdb prompts for a NEW local superuser password; never reuse production credentials.
& initdb.exe --pgdata=$RestoreRoot --username=$RestoreUser `
  --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwprompt
if ($LASTEXITCODE -ne 0) { throw 'Disposable cluster initialization failed' }
& pg_ctl.exe --pgdata=$RestoreRoot --options="-p $RestorePort -h 127.0.0.1" `
  --log="$RestoreRoot\server.log" --wait start
if ($LASTEXITCODE -ne 0) { throw 'Disposable cluster startup failed' }

$localSql = "SELECT current_database(), inet_server_addr()::text, " +
            "inet_server_port()::text, pg_is_in_recovery()::text"
$localIdentity = & psql.exe -X -A -t -F '|' -v ON_ERROR_STOP=1 -W `
  --host=127.0.0.1 "--port=$RestorePort" "--username=$RestoreUser" `
  --dbname=postgres --command=$localSql
if ($LASTEXITCODE -ne 0) { throw 'Local restore server identity check failed' }
$localFields = (($localIdentity | Select-Object -Last 1) -split '\|', 4)
if ($localFields.Count -ne 4 -or $localFields[0] -ne 'postgres' -or
    $localFields[1] -notmatch '^127\.0\.0\.1(/32)?$' -or
    $localFields[2] -ne $RestorePort -or $localFields[3] -notin @('f', 'false')) {
  throw 'Not an isolated localhost PostgreSQL server; no restore attempted'
}
& createdb.exe -W --host=127.0.0.1 "--port=$RestorePort" `
  "--username=$RestoreUser" --encoding=UTF8 --template=template0 $RestoreDb
if ($LASTEXITCODE -ne 0) { throw 'Empty restore database creation failed' }
& pg_restore.exe -W --host=127.0.0.1 "--port=$RestorePort" `
  "--username=$RestoreUser" "--dbname=$RestoreDb" `
  --single-transaction --exit-on-error --no-owner --no-acl --no-tablespaces $Archive
$restoreStatus = $LASTEXITCODE
Set-Content -LiteralPath "$Archive.restore-exit-status" -Value $restoreStatus -Encoding Ascii
if ($restoreStatus -ne 0) { throw 'Restore failed; backup remains unverified' }
```

4. **Validate the restored data, while still offline.** Run this read-only validation query only against the explicit loopback host, port and disposable database. Keep the output in the same protected folder; compare against a separately reviewed, time-appropriate source baseline. A live table count collected before/after `pg_dump` is **not necessarily equal** to the dump's consistent snapshot when normal writes continue. Record expected zeros rather than assuming that every model/snapshot table is populated.

```powershell
$validationSql = @'
SELECT 'public_tables' AS item, count(*) AS n FROM pg_class c
  JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind IN ('r','p')
UNION ALL
SELECT 'public_indexes', count(*) FROM pg_class c
  JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind IN ('i','I')
UNION ALL SELECT 'games', count(*) FROM public.games
UNION ALL SELECT 'team_game_stats', count(*) FROM public.team_game_stats
UNION ALL SELECT 'qb_game_stats', count(*) FROM public.qb_game_stats
UNION ALL SELECT 'player_game_stats', count(*) FROM public.player_game_stats
UNION ALL SELECT 'nflverse_source_files', count(*) FROM public.nflverse_source_files
UNION ALL SELECT 'model_versions', count(*) FROM public.model_versions
UNION ALL SELECT 'model_training_runs', count(*) FROM public.model_training_runs
UNION ALL SELECT 'model_promotion_history', count(*) FROM public.model_promotion_history
UNION ALL SELECT 'prediction_snapshots', count(*) FROM public.prediction_snapshots
UNION ALL SELECT 'release_security_evidence', count(*) FROM public.release_security_evidence;
SELECT s.nspname AS schema_name, c.relkind, c.relname AS object_name
  FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname NOT IN ('pg_catalog','information_schema')
    AND s.nspname NOT LIKE 'pg_toast%' AND s.nspname NOT LIKE 'pg_temp_%'
    AND c.relkind IN ('r','p','i','I','v','m','S')
  ORDER BY s.nspname, c.relkind, c.relname;
SELECT season, count(*) AS games FROM public.games GROUP BY season ORDER BY season;
SELECT game_id, season, week, game_date, game_status FROM public.games
  ORDER BY created_at DESC LIMIT 10;
SELECT season, count(*) AS team_rows FROM public.team_game_stats
  GROUP BY season ORDER BY season;
SELECT family, role, model_version, promoted_at FROM public.model_promotion_history
  ORDER BY promoted_at DESC LIMIT 10;
SELECT model_version, status, model_artifact IS NOT NULL AS artifact_present
  FROM public.model_training_runs ORDER BY trained_at DESC LIMIT 10;
SELECT id, game_id, prediction_timestamp FROM public.prediction_snapshots
  ORDER BY prediction_timestamp DESC LIMIT 10;
SELECT build_id, checked_at FROM public.release_security_evidence
  ORDER BY checked_at DESC LIMIT 5;
'@
& psql.exe -X -v ON_ERROR_STOP=1 -W --host=127.0.0.1 `
  "--port=$RestorePort" "--username=$RestoreUser" "--dbname=$RestoreDb" `
  --command=$validationSql
if ($LASTEXITCODE -ne 0) { throw 'Restored-data validation failed' }
& pg_ctl.exe --pgdata=$RestoreRoot --wait stop
if ($LASTEXITCODE -ne 0) { throw 'Local test server did not shut down cleanly' }
```

Compare the archive's table/index inventory with the restored catalog, check meaningful historical season coverage, inspect approved model/promotion evidence and the latest legitimate records known **at the dump snapshot**, and document any mismatches. Verify any **independently recorded** model-artifact checksums where available; the JSON model artifacts in `model_training_runs` are part of the database archive, but files referred to by paths and any external artifact store are **not**. Do not claim external assets are protected by `pg_dump`. This test uses `--no-owner --no-acl --no-tablespaces`, so it **does not validate restoration of original roles, permissions, or tablespace placement**; PostgreSQL roles and other cluster-wide settings also need separate protection. A `pg_dump` backup has no automatic replay of legitimate writes after its snapshot; retain a separate post-backup write/change ledger and plan reconciliation before any future recovery cutover. Record restoration status, date, source build fingerprint, hash, archive location (without credentials), schema/table/index comparisons, data checks, and limitations. Do not delete the disposable cluster until the owner has reviewed the results.

## Phase 4: evidence to record after approval and execution

No values below have been produced or verified yet. In a private owner-controlled recovery record, fill in the archive's exact path, completed UTC timestamp, source build ID/database identity, custom-format dump exit status, byte size, SHA-256, archive-list status, local restore-cluster identity, restore exit status, schema/table/index comparison, historical data coverage, model promotions and artifact-checksum findings, persisted predictions, and recent-record checks. Record missing assets or discrepancies explicitly; retain the last-good source baseline and a ledger of legitimate writes **after** the backup for reconciliation. A successful archive listing, checksum, or database connection by itself is **not** a verified independent backup.

**Phase 2 is authorized for one owner-run attempt, subject to the stated local checks. Phase 3 is NOT authorized: do not restore anywhere without new express approval.** The Agent cannot remotely run this script on the owner's private computer. The owner can share only **redacted, non-sensitive** evidence afterward: the archive SHA-256, UTC completion time, byte size, exit status, source database/build identity, and whether `pg_restore --list` succeeded. No URL, password, secret file, unredacted backup path, archive, table contents, or private ACL account names should be sent in chat. On receipt, report archive integrity checks honestly; do not claim a verified independent *restore* before a separately approved restore test succeeds.

BACKUP NOT YET VERIFIED