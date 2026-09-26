# Gridline independent production backup — preparation only

**Status: BACKUP NOT YET VERIFIED.** No production credential was accessed, no dump was executed, no restore was attempted, and no production data, worker, binding, or deployment was changed by this preparation.

## Phase 1 evidence and unresolved prerequisites

- The available Replit-workspace `pg_dump` and `pg_restore` clients are PostgreSQL **16.10**. Replit's managed production read-only query reports `neondb`, role `neondb_owner`, PostgreSQL **16.15**, and approximately **660 MB** of logical database storage. The client and server have the same major version, but **the Windows backup computer's PostgreSQL client installation has not been verified**. This read-only query is not access to the production connection credential.
- The latest production release-evidence build ID is **`7b057630d4a8-2026-09-26T02:31:27.142Z`**; the same ID appears in live deployment logs. This is newer than the previously recorded production build. Recheck it against live logs immediately before any approved dump and fail closed if it changes. A matching name or version alone is not enough to identify Gridline's live database.
- [Replit documents](https://docs.replit.com/features/data-and-storage/connection-details#connect-an-external-tool) a production connection string in **Database → Production Database → Settings**, usable by an external PostgreSQL client. It does **not** document a separate externally usable read-only credential or replica endpoint. The Agent's read-only production query interface cannot stream a full `pg_dump` archive. Do not confuse the development shell's `DATABASE_URL` with the production credential.
- [PostgreSQL documents](https://www.postgresql.org/docs/16/app-pgdump.html) that `pg_dump` creates a consistent export without blocking ordinary readers or writers. It still consumes production read I/O and can conflict with schema DDL; a short lock wait limit should fail rather than stall. A client-side read-only session is possible even if the only available credential itself is write-capable, but **this is not a database-enforced read-only role**.
- Proposed credential method: the owner uses a private libpq service file (`PGSERVICEFILE`) for connection settings and a private password file (`PGPASSFILE`) **on the BitLocker-protected Windows computer**, in a restricted credentials folder **separate from the archive destination**. The service must require certificate-verified TLS (for example `sslmode=verify-full` with an appropriate trust root), never disabled TLS. PostgreSQL documents both [service files](https://www.postgresql.org/docs/16/libpq-pgservice.html) and [password files](https://www.postgresql.org/docs/16/libpq-pgpass.html) on Windows. The password must never enter this project, backup archive folder, shell history, command arguments, logs, or chat. The owner would configure these files from the **Production** Settings UI only **after** separately authorizing credential access. Do not copy production credentials into Replit development variables or replace `DATABASE_URL`. Because the separate read-only credential/replica remains **unconfirmed**, the proposed session defaults to read-only, but this does not reduce the underlying credential's privileges.
- **Destination owner-confirmed, not independently inspected:** a private, BitLocker-encrypted Windows computer outside Replit, with **at least 3 GiB free** and access restricted to authorized operators. The exact encrypted drive/folder and ACLs still need local verification before execution; an independent disposable restore target needs its own capacity. The owner has **not** confirmed whether Production Database Settings offers a separate read-only credential or replica connection.

## Exact proposed Phase 2 commands — for review, NOT executed

Run only on the approved **Windows** computer after separate authorization, in PowerShell, using PostgreSQL 16 client tools installed on that computer. Replace `X:\Private\Gridline` with the verified BitLocker-protected folder on the owner's chosen local drive; use the same protected volume for the service and password files. The owner must inspect Windows ACLs on those files and folder before running the commands. The service file's `gridline-prod-backup` section must refer to the production Settings connection, not development. Do not paste the file contents into chat. The script refuses a mismatched database, PostgreSQL major, read-only session, or reviewed live build ID before dumping.

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
       "(SELECT build_id FROM public.release_security_evidence ORDER BY checked_at DESC LIMIT 1)"
$identity = & psql.exe -X -A -t -F '|' -v ON_ERROR_STOP=1 "--dbname=$Service" --command=$sql
if ($LASTEXITCODE -ne 0) { throw 'Production identity preflight failed' }
$fields = (($identity | Where-Object { $_ -match '\|' } | Select-Object -Last 1) -split '\|', 5)
if ($fields.Count -ne 5 -or $fields[0] -ne 'neondb' -or
    $fields[2] -notmatch '^16\d{4}$' -or $fields[3] -ne 'on' -or
    $fields[4] -ne $ExpectedBuildId) {
  throw 'Production identity mismatch; no dump was attempted'
}

$archive = Join-Path $BackupDir ("gridline-neondb-{0:yyyyMMddTHHmmssZ}.dump" -f [DateTime]::UtcNow)
$partial = "$archive.partial"
if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $partial)) {
  throw 'Archive filename already exists'
}
$ErrorActionPreference = 'Continue' # preserve native stderr and capture pg_dump exit status
& pg_dump.exe "--dbname=$Service" --format=custom --serializable-deferrable `
  --lock-wait-timeout=5s "--file=$partial" 2> "$archive.stderr"
$dumpStatus = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Set-Content -LiteralPath "$archive.exit-status" -Value $dumpStatus
if ($dumpStatus -ne 0 -or (Get-Item -LiteralPath $partial).Length -eq 0) {
  throw 'Dump failed or produced an empty file; do not use the partial archive'
}
Move-Item -LiteralPath $partial -Destination $archive
[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ') |
  Set-Content -LiteralPath "$archive.completed-utc"
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($archive))" |
  Set-Content -LiteralPath "$archive.sha256"
& pg_restore.exe --list $archive > "$archive.toc"
if ($LASTEXITCODE -ne 0) { throw 'Archive listing failed; backup is not verified' }
```

The role name is returned by the identity query but is not used to authorize the source. If a dedicated read-only role exists, it may differ from `neondb_owner`. A stale `$ExpectedBuildId` intentionally stops the script; refresh the baseline from read-only production evidence and live logs **before** approval and execution rather than loosening the check. The short lock wait or read-only session can make a dump fail safely. The `.stderr`, `.exit-status`, timestamp, checksum, and archive listing remain in the private destination. Windows file ACL restrictions on the password file and backup folder are an explicit owner verification step; BitLocker alone does not restrict access while the computer is unlocked.

An archive listing and checksum establish only preliminary integrity; they **do not** prove that the backup restores. After **separate authorization to restore anywhere**, restore into a newly provisioned disposable database outside production and compare the schema, table/index inventory, game history, model and promotion metadata, prediction snapshots, recent legitimate records, and artifact checksums. `pg_dump` is a logical database snapshot; it does not automatically protect external model artifacts, cluster-wide roles/settings, or writes made after completion. Preserve subsequent legitimate writes separately and reconcile them during any later recovery.

**Do not proceed to Phase 2 or Phase 3 until the owner has verified the private folder and Windows PostgreSQL 16 tools, resolved or explicitly accepted the lack of a confirmed read-only credential/replica, and given explicit authorization for credential access, backup execution, and the isolated restore.**

BACKUP NOT YET VERIFIED