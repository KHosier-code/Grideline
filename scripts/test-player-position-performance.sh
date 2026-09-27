#!/usr/bin/env bash
# Disposable database only: never read, copy or modify the development import.
set -euo pipefail
cd "$(dirname "$0")/.."
TEMP=$(mktemp -d /tmp/gridline-position-performance.XXXXXXXX)
PORT=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
cleanup() {
  pg_ctl -D "$TEMP/cluster" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
initdb -D "$TEMP/cluster" -A trust --no-instructions > "$TEMP/init.log"
printf "listen_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\nshared_preload_libraries = 'pg_stat_statements'\n" \
  "$PORT" "$TEMP" >> "$TEMP/cluster/postgresql.conf"
pg_ctl -D "$TEMP/cluster" -l "$TEMP/postgres.log" start >/dev/null
createdb -h 127.0.0.1 -p "$PORT" -U "$(id -un)" gridline_position_fixture
URL="postgresql://$(id -un)@127.0.0.1:${PORT}/gridline_position_fixture"
# Only the URL created above crosses into schema setup and the test process.
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" \
  pnpm --dir lib/db exec drizzle-kit push --force > "$TEMP/schema.log" || {
    cat "$TEMP/schema.log" >&2; exit 1;
  }
psql "$URL" -v ON_ERROR_STOP=1 -qc 'CREATE EXTENSION pg_stat_statements'
psql "$URL" -v ON_ERROR_STOP=1 -f scripts/player-position-performance-fixture.sql > "$TEMP/fixture.log"
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" GRIDLINE_PLAYER_POSITION_FIXTURE=1 \
  node --test artifacts/api-server/dist/lib/player-position-matchup-performance.test.mjs