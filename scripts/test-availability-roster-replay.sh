#!/usr/bin/env bash
# Run the HTTP replay against a disposable PostgreSQL cluster, never development data.
set -euo pipefail
cd "$(dirname "$0")/.."
TEMP=$(mktemp -d /tmp/gridline-roster-replay.XXXXXXXX)
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
createdb -h 127.0.0.1 -p "$PORT" -U "$(id -un)" gridline_roster_replay_fixture
URL="postgresql://$(id -un)@127.0.0.1:${PORT}/gridline_roster_replay_fixture"
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" \
  pnpm --dir lib/db exec drizzle-kit push --force > "$TEMP/schema.log" || {
    cat "$TEMP/schema.log" >&2; exit 1;
  }
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" GRIDLINE_ROSTER_REPLAY_FIXTURE=1 \
  node --test artifacts/api-server/dist/lib/availability-roster-replay.test.mjs