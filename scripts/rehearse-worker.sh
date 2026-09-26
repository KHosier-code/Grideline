#!/usr/bin/env bash
# Disposable only. Never sources workspace environment or copies database rows.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55429
if pg_isready -h 127.0.0.1 -p "$PORT" -q; then
  echo "Refusing rehearsal: reserved local port is already in use" >&2
  exit 1
fi
TEMP=$(mktemp -d /tmp/gridline-worker-rehearsal.XXXXXXXX)
cleanup() {
  pg_ctl -D "$TEMP/cluster" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
initdb -D "$TEMP/cluster" -A trust --no-instructions > "$TEMP/init.log"
printf "listen_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\n" \
  "$PORT" "$TEMP" >> "$TEMP/cluster/postgresql.conf"
pg_ctl -D "$TEMP/cluster" -l "$TEMP/postgres.log" start >/dev/null
LOCAL_URL="postgresql://$(id -un)@127.0.0.1:${PORT}/gridline_rehearsal"
createdb -h 127.0.0.1 -p "$PORT" -U "$(id -un)" gridline_rehearsal
MARKER=$(openssl rand -hex 16)
SYSTEM_ID=$(psql "$LOCAL_URL" -Atqc 'SELECT system_identifier FROM pg_control_system()')
psql -h 127.0.0.1 -p "$PORT" -U "$(id -un)" -d postgres \
  -qc "COMMENT ON DATABASE gridline_rehearsal IS 'gridline-disposable:${MARKER}'"
export DATABASE_URL="$LOCAL_URL" GRIDLINE_WORKER_REHEARSAL=1
export GRIDLINE_REHEARSAL_NO_PROVIDERS=1 GRIDLINE_REHEARSAL_NO_SCHEDULED_EXECUTION=1
export GRIDLINE_REHEARSAL_NO_RETENTION=1 GRIDLINE_REHEARSAL_MARKER="$MARKER"
export GRIDLINE_REHEARSAL_SYSTEM_ID="$SYSTEM_ID"
export GRIDLINE_REHEARSAL_NOW="2026-09-26T02:09:54.000Z"
unset GRIDLINE_NEW_WORKER_APPROVED GRIDLINE_SCHEDULER_WORKER

# Force is safe only because this cluster and empty database were just created
# by this invocation. No schema operation is run against an inherited URL.
pnpm --dir lib/db exec drizzle-kit push --force > "$TEMP/schema.log"
pnpm --filter @workspace/api-server run build > "$TEMP/build.log"
node artifacts/api-server/dist/rehearsal-cli.mjs seed > "$TEMP/seed.json"
node artifacts/api-server/dist/rehearsal-cli.mjs audit > "$TEMP/before.json"
node artifacts/api-server/dist/worker.mjs > "$TEMP/worker.log" 2>&1
node artifacts/api-server/dist/rehearsal-cli.mjs audit > "$TEMP/after.json"
node artifacts/api-server/dist/rehearsal-cli.mjs writer > "$TEMP/writer.json"

# A single sanitized, reproducible record: never include DB URLs or markers.
node - "$TEMP" <<'NODE' > reports/gridline-worker-rehearsal-results.json
const fs = require("node:fs");
const dir = process.argv[2];
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, "utf8"));
const before = read("before"), after = read("after");
const writer = read("writer");
process.stdout.write(JSON.stringify({
  provenance: "Synthetic keys from the 2026-09-26 read-only report; synthetic teams, fixtures, model coefficients and timestamps. No copy of live rows.",
  clock: after.clock,
  before: { schedulerRuns: before.schedulerRuns, itemized: before.itemized },
  after: { schedulerRuns: after.schedulerRuns, byKind: after.byKind,
    newlyReconciled: after.newlyReconciled, historicalFreezes: after.historicalFreezes,
    itemized: after.itemized, providerContacts: after.providerContacts,
    scheduledExecutions: after.scheduledExecutions,
    retentionDeletions: after.retentionDeletions,
    liveDatabaseWrites: after.liveDatabaseWrites },
  writer
}, null, 2) + "\n");
NODE
echo "Disposable rehearsal passed. Sanitized results: reports/gridline-worker-rehearsal-results.json"