#!/usr/bin/env bash
# Isolated proof of the actual worker's selective branch. No inherited database or approval flags.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55431
if pg_isready -h 127.0.0.1 -p "$PORT" -q; then
  echo "Refusing recovery test: reserved local port occupied" >&2
  exit 1
fi
TEMP=$(mktemp -d /tmp/gridline-player-recovery.XXXXXXXX)
cleanup() {
  pg_ctl -D "$TEMP/cluster" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
initdb -D "$TEMP/cluster" -A trust --no-instructions > "$TEMP/init.log"
printf "listen_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\n" \
  "$PORT" "$TEMP" >> "$TEMP/cluster/postgresql.conf"
pg_ctl -D "$TEMP/cluster" -l "$TEMP/postgres.log" start >/dev/null
URL="postgresql://$(id -un)@127.0.0.1:${PORT}/gridline_rehearsal"
createdb -h 127.0.0.1 -p "$PORT" -U "$(id -un)" gridline_rehearsal
MARKER=$(openssl rand -hex 16)
psql -h 127.0.0.1 -p "$PORT" -U "$(id -un)" -d postgres \
  -v marker="$MARKER" -qc "COMMENT ON DATABASE gridline_rehearsal IS 'gridline-disposable:${MARKER}'"
SYSTEM_ID=$(psql "$URL" -Atqc 'SELECT system_identifier FROM pg_control_system()')
OID=$(psql "$URL" -Atqc 'SELECT oid FROM pg_database WHERE datname=current_database()')
ADDRESS=$(psql "$URL" -Atqc 'SELECT inet_server_addr()::text')
run() {
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development DATABASE_URL="$URL" \
    GRIDLINE_PLAYER_RECOVERY="$1" GRIDLINE_PLAYER_RECOVERY_APPROVED=1 \
    GRIDLINE_PLAYER_RECOVERY_TEST_BLOCK_NETWORK=1 \
    GRIDLINE_PLAYER_RECOVERY_DATABASE=gridline_rehearsal \
    GRIDLINE_PLAYER_RECOVERY_ROLE="$(id -un)" \
    GRIDLINE_PLAYER_RECOVERY_SYSTEM_ID="$SYSTEM_ID" \
    GRIDLINE_PLAYER_RECOVERY_DATABASE_OID="$OID" \
    GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS="$ADDRESS" \
    GRIDLINE_PLAYER_RECOVERY_MARKER="$MARKER" \
    node artifacts/api-server/dist/worker.mjs
}
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" \
  pnpm --dir lib/db exec drizzle-kit push --force > "$TEMP/schema.log"
pnpm --filter @workspace/api-server run build > "$TEMP/build.log"
psql "$URL" -v ON_ERROR_STOP=1 -qc "
  INSERT INTO usage_analytics_events (event_name, created_at)
  VALUES ('disposable-retention-sentinel', now() - interval '60 days');
  INSERT INTO usage_analytics_retention (id, last_attempt_status)
  VALUES (1, 'sentinel');
"
# Identity mismatch must fail before even a sync-run row is written.
if env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development DATABASE_URL="$URL" \
    GRIDLINE_PLAYER_RECOVERY=injuries GRIDLINE_PLAYER_RECOVERY_APPROVED=1 \
    GRIDLINE_PLAYER_RECOVERY_TEST_BLOCK_NETWORK=1 \
    GRIDLINE_PLAYER_RECOVERY_DATABASE=gridline_rehearsal \
    GRIDLINE_PLAYER_RECOVERY_ROLE="$(id -un)" \
    GRIDLINE_PLAYER_RECOVERY_SYSTEM_ID=12345678901234567890 \
    GRIDLINE_PLAYER_RECOVERY_DATABASE_OID="$OID" \
    GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS="$ADDRESS" \
    GRIDLINE_PLAYER_RECOVERY_MARKER="$MARKER" \
    node artifacts/api-server/dist/worker.mjs > "$TEMP/mismatch.log" 2>&1; then
  echo "Identity mismatch unexpectedly accepted" >&2; exit 1
fi
if run injuries > "$TEMP/injuries.log" 2>&1; then
  echo "Blocked ESPN request unexpectedly succeeded" >&2; exit 1
fi
if run sleeper > "$TEMP/sleeper.log" 2>&1; then
  echo "Blocked Sleeper request unexpectedly succeeded" >&2; exit 1
fi
if run injuries,sleeper > "$TEMP/both.log" 2>&1; then
  echo "Blocked combined provider requests unexpectedly succeeded" >&2; exit 1
fi
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM data_sync_runs) <> 4
    OR (SELECT count(*) FROM data_sync_runs WHERE status='failed'
        AND job_key='operator-player-recovery'
        AND provider='espn-injuries') <> 2
    OR (SELECT count(*) FROM data_sync_runs WHERE status='failed'
        AND job_key='operator-player-recovery'
        AND provider='sleeper-players') <> 2
    OR (SELECT count(*) FROM data_sync_runs WHERE error_message LIKE '%Disposable recovery blocked provider fetch%') <> 2
    OR (SELECT count(*) FROM data_sync_runs WHERE provider='sleeper-players'
        AND metadata->>'errorKind'='network') <> 2
    OR (SELECT count(*) FROM scheduler_jobs) <> 0
    OR (SELECT count(*) FROM odds_api_requests) <> 0
    OR (SELECT count(*) FROM injuries) <> 0
    OR (SELECT count(*) FROM sleeper_player_snapshots) <> 0
    OR (SELECT count(*) FROM model_training_runs) <> 0
    OR (SELECT count(*) FROM usage_analytics_events
        WHERE event_name='disposable-retention-sentinel') <> 1
    OR (SELECT count(*) FROM usage_analytics_retention
        WHERE id=1 AND last_attempt_status='sentinel') <> 1
  THEN RAISE EXCEPTION 'Selective recovery modified an unrelated table or missed a selected observation';
  END IF;
END $$;
SQL
echo "Disposable selective recovery passed: single and combined selections blocked; no scheduler, paid, model, retention or snapshot activity."