#!/usr/bin/env bash
# No inherited database, Clerk keys, or odds provider credentials reach this fixture.
set -euo pipefail
cd "$(dirname "$0")/.."
TEMP=$(mktemp -d /tmp/gridline-retrospective.XXXXXXXX)
PORT=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
cleanup() {
  pg_ctl -D "$TEMP/cluster" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
initdb -D "$TEMP/cluster" -A trust --no-instructions > "$TEMP/init.log"
printf "listen_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\n" \
  "$PORT" "$TEMP" >> "$TEMP/cluster/postgresql.conf"
pg_ctl -D "$TEMP/cluster" -l "$TEMP/postgres.log" start >/dev/null
createdb -h 127.0.0.1 -p "$PORT" -U "$(id -un)" gridline_retrospective_fixture
URL="postgresql://$(id -un)@127.0.0.1:${PORT}/gridline_retrospective_fixture"
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" \
  pnpm --dir lib/db exec drizzle-kit push --force > "$TEMP/schema.log" || {
    cat "$TEMP/schema.log" >&2; exit 1;
  }
# Drizzle push creates constraints but not the SQL migration's append-only triggers.
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL' > "$TEMP/triggers.log"
CREATE FUNCTION reject_initial_pick_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'initial-line evidence is immutable'; END $$;
CREATE TRIGGER initial_line_immutable BEFORE UPDATE OR DELETE ON initial_line_picks
 FOR EACH ROW EXECUTE FUNCTION reject_initial_pick_mutation();
CREATE TRIGGER initial_weekly_immutable BEFORE UPDATE OR DELETE ON initial_weekly_picks
 FOR EACH ROW EXECUTE FUNCTION reject_initial_pick_mutation();
CREATE TRIGGER retrospective_weekly_reviews_immutable BEFORE UPDATE OR DELETE ON retrospective_weekly_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_initial_pick_mutation();
SQL
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" NODE_ENV=development \
  GRIDLINE_RETROSPECTIVE_FIXTURE=1 node --test artifacts/api-server/dist/lib/retrospective-publication.test.mjs