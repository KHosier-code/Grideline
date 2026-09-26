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
- The latest read-only production release-evidence build ID was reconfirmed as **`7b057630d4a8-2026-09-26T02:31:27.142Z`**; that ID is also present in live deployment logs. This is the reviewed baseline, not an assertion that it cannot change. Recheck the live deployment before the owner runs the backup and fail closed if it changes. A matching name or version alone is not enough to identify Gridline's live database.
- [Replit documents](https://docs.replit.com/features/data-and-storage/connection-details#connect-an-external-tool) a production connection string in **Database → Production Database → Settings**, usable by an external PostgreSQL client. **The owner inspected those Settings and reports that only the standard production `DATABASE_URL` and its individual variables are visible; no separate read-only or replica connection is shown.** The documentation does not describe one either. This establishes what is visible in Settings, not that no restricted access could ever be provisioned by other means. The Agent's read-only production query interface cannot stream a full `pg_dump` archive. Do not confuse the development shell's `DATABASE_URL` with the production credential.
- [PostgreSQL documents](https://www.postgresql.org/docs/16/app-pgdump.html) that `pg_dump` creates a consistent export without blocking ordinary readers or writers. It still consumes production read I/O and can conflict with schema DDL; a short lock wait limit should fail rather than stall. A client-side read-only session is possible even if the only available credential itself is write-capable, but **this is not a database-enforced read-only role**.
- Proposed credential method: the owner uses `C:\GridlineCredentials\prod-backup.pg_service.conf` for non-secret connection settings, `C:\GridlineCredentials\prod-backup.pgpass` for the password, and a separately verified trusted CA PEM at `C:\GridlineCredentials\root.crt`. These are on the BitLocker-protected `C:` drive **outside** the archive folder. PostgreSQL documents Windows [service files](https://www.postgresql.org/docs/16/libpq-pgservice.html), [password files](https://www.postgresql.org/docs/16/libpq-pgpass.html), and [CA-file verification](https://www.postgresql.org/docs/16/libpq-ssl.html). PostgreSQL 16's `verify-full` requires a trust root and checks the endpoint hostname; **TLS compatibility has not been proven on the owner's computer** and must fail closed in the local preflight. Do not assume Windows' certificate store is used by libpq 16. The password must never enter the project, archive folder, shell history, application logs, Git, or chat. Do not use Replit development `DATABASE_URL`; treat the standard production credential as potentially write-capable even though the client session is read-only.
- **Destination owner-confirmed, not independently inspected:** `C:\GridlineBackups` on the owner's BitLocker-protected Windows computer outside Replit. The owner confirmed at least 3 GiB free; local BitLocker status and ACLs still must be checked before the single authorized attempt. The separate credentials folder is `C:\GridlineCredentials`. Any isolated restore target needs its own capacity and separate approval.

## Phase 1: Windows folder, credential, and CA preparation — owner only

Use **Windows PowerShell 5.1** on the owner's BitLocker-protected computer. These steps do not contact the database. No permanent `PATH` edit is needed; PostgreSQL executables are in `C:\Program Files\PostgreSQL\16\bin`. The owner has already conditionally authorized one backup but **not** any restore.

1. Check `Get-BitLockerVolume -MountPoint C:` reports `ProtectionStatus` **On** and `VolumeStatus` **FullyEncrypted**, and `Get-Volume -DriveLetter C` shows at least 3 GiB free. If the BitLocker cmdlet or volume query requires administrator rights, use an **elevated** Windows PowerShell 5.1 window **only for folder setup and this check**; close it before using credentials. The setup window must run as the **same Windows account** that will later run the backup; if elevation switches accounts, stop and have an administrator grant the intended operator's SID instead.
2. In that elevated same-account window, create **new** folders with restricted ACLs using the following commands. Existing folders are **not modified**; inspect their ACLs and have the owner approve their existing access instead. No credentials belong in these commands.

   ```powershell
   $BackupDir = 'C:\GridlineBackups'
   $CredDir = 'C:\GridlineCredentials'
   $operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
   foreach ($folder in @($BackupDir, $CredDir)) {
     if (Test-Path -LiteralPath $folder) {
       if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
         throw "Expected a folder: $folder"
       }
       Write-Output "Existing folder needs ACL review: $folder"
       continue
     }
     New-Item -ItemType Directory -Path $folder -ErrorAction Stop | Out-Null
     & icacls.exe $folder '/inheritance:r' '/grant:r' `
       "*$($operatorSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' `
       '*S-1-5-32-544:(OI)(CI)F' | Out-Null
     if ($LASTEXITCODE -ne 0) { throw "Folder ACL setup failed: $folder" }
   }
   Get-BitLockerVolume -MountPoint 'C:' | Select-Object MountPoint, ProtectionStatus, VolumeStatus
   Get-Volume -DriveLetter C | Select-Object DriveLetter, SizeRemaining
   Get-Acl -LiteralPath $BackupDir | Select-Object -ExpandProperty Access
   Get-Acl -LiteralPath $CredDir | Select-Object -ExpandProperty Access
   ```

   Inspect both ACLs locally. The only approved allowed principals are the operator, SYSTEM, and local Administrators **if the owner approves administrator access**. Broad groups (Everyone, Users, Authenticated Users), inherited broad access, unknown principals, or a failed permission check mean **stop**. Folder setup may require administrator privileges; **the backup itself should run non-elevated**. Close the elevated window.
3. Obtain the server's CA trust root as a **PEM** file through an independently trusted CA/provider source; verify its origin/fingerprint out of band and save it as `C:\GridlineCredentials\root.crt`. **Do not trust a certificate merely because it was returned by the database endpoint.** PostgreSQL 16 libpq on Windows expects a CA file; do not assume the Windows certificate store will be used. If the correct chain cannot be established, **stop**. No fallback to `sslmode=require`, `prefer`, or `disable` is allowed.
4. From a **new, non-elevated** PowerShell window, open `notepad.exe C:\GridlineCredentials\prod-backup.pg_service.conf` and type the following template using **only the production Settings** host, port, database and user. Save as **All Files**, UTF-8 without BOM, with the exact filename; never put the password or URL in the service file or a PowerShell command. Use the production DNS hostname, not a bare IP, for hostname verification.

   ```ini
   [gridline-prod-backup]
   host=PRODUCTION_DNS_HOST_FROM_SETTINGS
   port=PRODUCTION_PORT_FROM_SETTINGS
   dbname=neondb
   user=PRODUCTION_USER_FROM_SETTINGS
   sslmode=verify-full
   sslrootcert=C:/GridlineCredentials/root.crt
   gssencmode=disable
   ```

5. Create `C:\GridlineCredentials\prod-backup.pgpass` from a **local masked prompt**, not from a typed command containing the password. Do not enable a PowerShell transcript. The commands below read non-secret connection fields from the service file, prompt for the secret without echoing it, escape PostgreSQL password-file separators, and write UTF-8 **without BOM** into the restricted credentials folder. Password material exists briefly in local process memory and in that private file; it is never printed or entered in PowerShell history. Close this setup window afterwards.

   ```powershell
   $serviceFile = 'C:\GridlineCredentials\prod-backup.pg_service.conf'
   $passFile = 'C:\GridlineCredentials\prod-backup.pgpass'
   if (Test-Path -LiteralPath $passFile) { throw 'Password file exists; stop for review' }
   $config = @{}
   $headers = @(Get-Content -LiteralPath $serviceFile |
     Where-Object { $_ -match '^\s*\[' })
   if ($headers.Count -ne 1 -or $headers[0].Trim() -ne '[gridline-prod-backup]') {
     throw 'Unexpected service section'
   }
   foreach ($line in Get-Content -LiteralPath $serviceFile) {
     $entry = $line.Trim()
     if ($entry -eq '' -or $entry.StartsWith('#') -or
         $entry -eq '[gridline-prod-backup]') { continue }
     if ($entry -notmatch '^(host|port|dbname|user|sslmode|sslrootcert|gssencmode)=(.+)$') {
       throw 'Unexpected service setting; stop'
     }
     if ($config.ContainsKey($matches[1])) { throw 'Duplicate service setting' }
     $config[$matches[1]] = $matches[2]
   }
   foreach ($key in @('host','port','dbname','user','sslmode','sslrootcert','gssencmode')) {
     if (-not $config.ContainsKey($key)) { throw "Missing service setting: $key" }
   }
   if ($config.dbname -ne 'neondb' -or $config.sslmode -ne 'verify-full' -or
       $config.sslrootcert -ne 'C:/GridlineCredentials/root.crt' -or
       $config.gssencmode -ne 'disable' -or
       -not (Test-Path -LiteralPath 'C:\GridlineCredentials\root.crt')) {
     throw 'Database or verified TLS configuration does not match the reviewed plan'
   }
   function Escape-Pgpass([string] $value) {
     return $value.Replace('\','\\').Replace(':','\:')
   }
   $secret = Read-Host 'Production database password (local masked prompt)' -AsSecureString
   $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
   try {
     $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
     $line = '{0}:{1}:{2}:{3}:{4}' -f `
       (Escape-Pgpass $config.host), (Escape-Pgpass $config.port), `
       (Escape-Pgpass $config.dbname), (Escape-Pgpass $config.user), `
       (Escape-Pgpass $plain)
     [IO.File]::WriteAllText($passFile, $line + "`n",
       (New-Object System.Text.UTF8Encoding($false)))
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
     Remove-Variable plain,line,secret -ErrorAction SilentlyContinue
   }
   Get-Acl -LiteralPath $serviceFile | Select-Object -ExpandProperty Access
   Get-Acl -LiteralPath $passFile | Select-Object -ExpandProperty Access
   Get-Acl -LiteralPath 'C:\GridlineCredentials\root.crt' |
     Select-Object -ExpandProperty Access
   ```

   Check the file ACLs: no broad or inherited **unapproved** read access. Keep the password file outside the archive folder and never share its contents, the URI, or the raw folder ACL output. If a file was accidentally created with a `.txt` suffix, or with incorrect encoding/ACLs, **stop and correct that locally before any database connection**.

## Phase 2: guarded one-attempt Windows backup — NOT executed

The owner has authorized one local attempt only after Phase 1 passes and the **current live deployment build ID** is confirmed. Read-only production evidence and deployment logs both showed `7b057630d4a8-2026-09-26T02:31:27.142Z` during this review; if the live release changes before execution, **stop and request a fresh reviewed identity baseline** rather than changing the guard to make it pass. The only production database operations below are a read-only `SELECT` and `pg_dump`. The archive streams directly over certificate-verified TLS into `C:\GridlineBackups`; nothing is staged in Replit or written to application logs. The `psql` preflight is the actual local compatibility test: if hostname or certificate-chain verification fails, it cannot pass; the Agent has not tested the owner's Windows trust configuration. Run this complete block in a fresh **non-elevated Windows PowerShell 5.1** window, then close the window after success or failure. If BitLocker or ACL verification cannot be read without elevation, stop for review rather than bypassing checks or automatically elevating the credential-bearing backup process. Do not run provider sync, worker, migration, publish or restore commands.

```powershell
$ErrorActionPreference = 'Stop'
$BackupDir = 'C:\GridlineBackups'
$CredDir = 'C:\GridlineCredentials'
$PgBin = 'C:\Program Files\PostgreSQL\16\bin'
$Psql = Join-Path $PgBin 'psql.exe'
$PgDump = Join-Path $PgBin 'pg_dump.exe'
$PgRestore = Join-Path $PgBin 'pg_restore.exe'
$ExpectedBuildId = '7b057630d4a8-2026-09-26T02:31:27.142Z'
$Service = 'service=gridline-prod-backup'
$env:PGSERVICEFILE = Join-Path $CredDir 'prod-backup.pg_service.conf'
$env:PGPASSFILE = Join-Path $CredDir 'prod-backup.pgpass'
$env:PGOPTIONS = '-c default_transaction_read_only=on'
$env:PGCONNECT_TIMEOUT = '10'
Remove-Item Env:PGPASSWORD,Env:PGHOST,Env:PGPORT,Env:PGDATABASE,Env:PGUSER,`
  Env:PGSERVICE,Env:PGSSLMODE,Env:PGSSLROOTCERT -ErrorAction SilentlyContinue

foreach ($tool in @($Psql, $PgDump, $PgRestore)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing client: $tool" }
  $version = & $tool --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch 'PostgreSQL\) 16\.15\b') {
    throw "PostgreSQL 16.15 client required: $tool"
  }
}
if (-not (Test-Path -LiteralPath $BackupDir -PathType Container) -or
    -not (Test-Path -LiteralPath $CredDir -PathType Container) -or
    -not (Test-Path -LiteralPath $env:PGSERVICEFILE -PathType Leaf) -or
    -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $CredDir 'root.crt') -PathType Leaf)) {
  throw 'The approved folders, service/password files, or trusted CA file are missing'
}
foreach ($path in @($BackupDir,$CredDir,$env:PGSERVICEFILE,$env:PGPASSFILE,
                    (Join-Path $CredDir 'root.crt'))) {
  if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Symbolic link or junction is not approved: $path"
  }
  if ([IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $path).Path) -ne 'C:\') {
    throw "Not on approved BitLocker C: drive: $path"
  }
}
$bitlocker = Get-BitLockerVolume -MountPoint 'C:'
if ($bitlocker.ProtectionStatus -ne 'On' -or
    $bitlocker.VolumeStatus -ne 'FullyEncrypted') {
  throw 'C: is not fully encrypted with active BitLocker protection'
}
if ((Get-Volume -DriveLetter C).SizeRemaining -lt 3GB) {
  throw 'Backup destination has less than 3 GiB free'
}
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids = @($operatorSid,'S-1-5-18','S-1-5-32-544')
function Assert-RestrictedAcl([string] $path, [bool] $protected) {
  $acl = Get-Acl -LiteralPath $path
  if ($protected -and -not $acl.AreAccessRulesProtected) {
    throw "Folder inherits permissions: $path"
  }
  foreach ($ace in $acl.Access) {
    if ($ace.AccessControlType -eq 'Allow') {
      $sid = $ace.IdentityReference.Translate(
        [Security.Principal.SecurityIdentifier]).Value
      if ($allowedSids -notcontains $sid) {
        throw "Unapproved ACL principal: $path"
      }
    }
  }
}
Assert-RestrictedAcl $BackupDir $true
Assert-RestrictedAcl $CredDir $true
foreach ($path in @($env:PGSERVICEFILE,$env:PGPASSFILE,
                    (Join-Path $CredDir 'root.crt'))) {
  Assert-RestrictedAcl $path $false
}
$config = @{}
$headers = @(Get-Content -LiteralPath $env:PGSERVICEFILE |
  Where-Object { $_ -match '^\s*\[' })
if ($headers.Count -ne 1 -or $headers[0].Trim() -ne '[gridline-prod-backup]') {
  throw 'Unexpected service section'
}
foreach ($line in Get-Content -LiteralPath $env:PGSERVICEFILE) {
  $entry = $line.Trim()
  if ($entry -eq '' -or $entry.StartsWith('#') -or
      $entry -eq '[gridline-prod-backup]') { continue }
  if ($entry -notmatch '^(host|port|dbname|user|sslmode|sslrootcert|gssencmode)=(.+)$') {
    throw 'Unexpected service setting'
  }
  if ($config.ContainsKey($matches[1])) { throw 'Duplicate service setting' }
  $config[$matches[1]] = $matches[2]
}
foreach ($key in @('host','port','dbname','user','sslmode','sslrootcert','gssencmode')) {
  if (-not $config.ContainsKey($key)) { throw "Missing service setting: $key" }
}
if ($config.dbname -ne 'neondb' -or $config.sslmode -ne 'verify-full' -or
    $config.sslrootcert -ne 'C:/GridlineCredentials/root.crt' -or
    $config.gssencmode -ne 'disable') {
  throw 'Verified TLS or source database configuration changed'
}

$sql = "SELECT current_database(), current_user, current_setting('server_version_num'), " +
       "current_setting('default_transaction_read_only'), " +
       "(SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()), " +
       "(SELECT build_id FROM public.release_security_evidence ORDER BY checked_at DESC LIMIT 1)"
$identity = & $Psql -X -A -t -F '|' -v ON_ERROR_STOP=1 "--dbname=$Service" --command=$sql
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
& $PgDump "--dbname=$Service" --format=custom --serializable-deferrable `
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
& $PgRestore --list $archive > "$archive.toc"
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
3. The following PowerShell plan creates a **new** PostgreSQL 16 cluster in a separate protected folder on the same encrypted `C:` drive, listens **only on `127.0.0.1:55432`**, uses password authentication, asserts loopback identity, creates an empty database, and restores the archive. Replace the example archive filename with the actual one. The cluster's locally prompted password is **not the production password**. If any preflight or restore exits nonzero, mark the backup **NOT VERIFIED** and investigate without touching production.

```powershell
$ErrorActionPreference = 'Stop'
$Archive = 'C:\GridlineBackups\gridline-neondb-REPLACE_WITH_ACTUAL_UTC_TIMESTAMP.dump'
$RestoreRoot = 'C:\GridlineRestoreCluster' # new, disposable, not the archive folder
$RestoreUser = 'gridline_restore_admin'
$RestoreDb = 'gridline_restore_test'
$RestorePort = '55432'
$PgBin = 'C:\Program Files\PostgreSQL\16\bin'
$Initdb = Join-Path $PgBin 'initdb.exe'
$PgCtl = Join-Path $PgBin 'pg_ctl.exe'
$Createdb = Join-Path $PgBin 'createdb.exe'
$PgRestore = Join-Path $PgBin 'pg_restore.exe'
$Psql = Join-Path $PgBin 'psql.exe'

# This is a NEW PowerShell window on an OFFLINE computer. No production credentials here.
Remove-Item Env:DATABASE_URL,Env:PGSERVICEFILE,Env:PGPASSFILE,Env:PGOPTIONS,`
  Env:PGPASSWORD,Env:PGHOST,Env:PGPORT,Env:PGDATABASE,Env:PGUSER `
  -ErrorAction SilentlyContinue
foreach ($tool in @($Initdb, $PgCtl, $Createdb, $PgRestore, $Psql)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "$tool is missing" }
  $version = & $tool --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch 'PostgreSQL\) 16\.15\b') {
    throw "PostgreSQL 16.15 server and client tools required: $tool"
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
& $Initdb --pgdata=$RestoreRoot --username=$RestoreUser `
  --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwprompt
if ($LASTEXITCODE -ne 0) { throw 'Disposable cluster initialization failed' }
& $PgCtl --pgdata=$RestoreRoot --options="-p $RestorePort -h 127.0.0.1" `
  --log="$RestoreRoot\server.log" --wait start
if ($LASTEXITCODE -ne 0) { throw 'Disposable cluster startup failed' }

$localSql = "SELECT current_database(), inet_server_addr()::text, " +
            "inet_server_port()::text, pg_is_in_recovery()::text"
$localIdentity = & $Psql -X -A -t -F '|' -v ON_ERROR_STOP=1 -W `
  --host=127.0.0.1 "--port=$RestorePort" "--username=$RestoreUser" `
  --dbname=postgres --command=$localSql
if ($LASTEXITCODE -ne 0) { throw 'Local restore server identity check failed' }
$localFields = (($localIdentity | Select-Object -Last 1) -split '\|', 4)
if ($localFields.Count -ne 4 -or $localFields[0] -ne 'postgres' -or
    $localFields[1] -notmatch '^127\.0\.0\.1(/32)?$' -or
    $localFields[2] -ne $RestorePort -or $localFields[3] -notin @('f', 'false')) {
  throw 'Not an isolated localhost PostgreSQL server; no restore attempted'
}
& $Createdb -W --host=127.0.0.1 "--port=$RestorePort" `
  "--username=$RestoreUser" --encoding=UTF8 --template=template0 $RestoreDb
if ($LASTEXITCODE -ne 0) { throw 'Empty restore database creation failed' }
& $PgRestore -W --host=127.0.0.1 "--port=$RestorePort" `
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
& $Psql -X -v ON_ERROR_STOP=1 -W --host=127.0.0.1 `
  "--port=$RestorePort" "--username=$RestoreUser" "--dbname=$RestoreDb" `
  --command=$validationSql
if ($LASTEXITCODE -ne 0) { throw 'Restored-data validation failed' }
& $PgCtl --pgdata=$RestoreRoot --wait stop
if ($LASTEXITCODE -ne 0) { throw 'Local test server did not shut down cleanly' }
```

Compare the archive's table/index inventory with the restored catalog, check meaningful historical season coverage, inspect approved model/promotion evidence and the latest legitimate records known **at the dump snapshot**, and document any mismatches. Verify any **independently recorded** model-artifact checksums where available; the JSON model artifacts in `model_training_runs` are part of the database archive, but files referred to by paths and any external artifact store are **not**. Do not claim external assets are protected by `pg_dump`. This test uses `--no-owner --no-acl --no-tablespaces`, so it **does not validate restoration of original roles, permissions, or tablespace placement**; PostgreSQL roles and other cluster-wide settings also need separate protection. A `pg_dump` backup has no automatic replay of legitimate writes after its snapshot; retain a separate post-backup write/change ledger and plan reconciliation before any future recovery cutover. Record restoration status, date, source build fingerprint, hash, archive location (without credentials), schema/table/index comparisons, data checks, and limitations. Do not delete the disposable cluster until the owner has reviewed the results.

## Phase 4: evidence to record after approval and execution

No values below have been produced or verified yet. In a private owner-controlled recovery record, fill in the archive's exact path, completed UTC timestamp, source build ID/database identity, custom-format dump exit status, byte size, SHA-256, archive-list status, local restore-cluster identity, restore exit status, schema/table/index comparison, historical data coverage, model promotions and artifact-checksum findings, persisted predictions, and recent-record checks. Record missing assets or discrepancies explicitly; retain the last-good source baseline and a ledger of legitimate writes **after** the backup for reconciliation. A successful archive listing, checksum, or database connection by itself is **not** a verified independent backup.

**Phase 2 is authorized for one owner-run attempt, subject to the stated local checks. Phase 3 is NOT authorized: do not restore anywhere without new express approval.** The Agent cannot remotely run this script on the owner's private computer. The owner can share only **redacted, non-sensitive** evidence afterward: the archive SHA-256, UTC completion time, byte size, exit status, source database/build identity, and whether `pg_restore --list` succeeded. No URL, password, secret file, unredacted backup path, archive, table contents, or private ACL account names should be sent in chat. On receipt, report archive integrity checks honestly; do not claim a verified independent *restore* before a separately approved restore test succeeds.

BACKUP NOT YET VERIFIED