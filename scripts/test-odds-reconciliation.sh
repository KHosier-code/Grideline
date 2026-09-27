#!/usr/bin/env bash
# Runs paid-ledger admission checks in a fresh loopback database, never the inherited DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55431
if pg_isready -h 127.0.0.1 -p "$PORT" -q; then
  echo "Refusing test: reserved local port is already in use" >&2
  exit 1
fi
TEMP=$(mktemp -d /tmp/gridline-odds-test.XXXXXXXX)
cleanup() {
  pg_ctl -D "$TEMP/cluster" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
initdb -D "$TEMP/cluster" -A trust --no-instructions > "$TEMP/init.log"
printf "listen_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\n" \
  "$PORT" "$TEMP" >> "$TEMP/cluster/postgresql.conf"
pg_ctl -D "$TEMP/cluster" -l "$TEMP/postgres.log" start >/dev/null
createdb -h 127.0.0.1 -p "$PORT" -U "$(id -un)" gridline_odds_test
export DATABASE_URL="postgresql://$(id -un)@127.0.0.1:${PORT}/gridline_odds_test"
export GRIDLINE_DISPOSABLE_ODDS_TEST=1
# Force applies only to this database, created above in this invocation.
pnpm --dir lib/db exec drizzle-kit push --force > "$TEMP/schema.log"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0047_odds_request_reconciliation.sql > "$TEMP/migration.log"
pnpm --filter @workspace/api-server run build > "$TEMP/build.log"
node --test artifacts/api-server/dist/lib/odds-reconciliation.test.mjs