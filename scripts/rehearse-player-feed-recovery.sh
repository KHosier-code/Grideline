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
  local fixture_env=()
  if [[ $# -gt 1 ]]; then
    fixture_env=(GRIDLINE_PLAYER_RECOVERY_TEST_FIXTURE="$2")
  fi
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development DATABASE_URL="$URL" \
    GRIDLINE_PLAYER_RECOVERY="$1" GRIDLINE_PLAYER_RECOVERY_APPROVED=1 \
    GRIDLINE_PLAYER_RECOVERY_TEST_BLOCK_NETWORK=1 \
    "${fixture_env[@]}" \
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
# Record attempted statements as well as final row counts: an update or a
# write followed by a delete must not pass merely because a table ends empty.
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE recovery_forbidden_writes (table_name text NOT NULL, operation text NOT NULL);
CREATE FUNCTION record_recovery_forbidden_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO recovery_forbidden_writes VALUES (TG_TABLE_NAME, TG_OP);
  RETURN NULL;
END $$;
DO $$
DECLARE
  protected_table text;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'scheduler_jobs', 'sportsbook_odds', 'odds_api_requests', 'odds_event_audits',
    'market_baseline_runs', 'market_baseline_events', 'market_baseline_quotes',
    'model_versions', 'model_training_runs', 'model_evaluation_predictions',
    'model_promotion_history', 'predictions', 'prediction_snapshots',
    'usage_analytics_events', 'usage_analytics_retention'
  ] LOOP
    EXECUTE format('CREATE TRIGGER recovery_write_audit AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH STATEMENT EXECUTE FUNCTION record_recovery_forbidden_write()', protected_table);
  END LOOP;
END $$;
SQL
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
        AND job_key LIKE 'operator-player-recovery:%'
        AND provider='espn-injuries') <> 2
    OR (SELECT count(*) FROM data_sync_runs WHERE status='failed'
        AND job_key LIKE 'operator-player-recovery:%'
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
    OR (SELECT count(*) FROM recovery_forbidden_writes) <> 0
  THEN RAISE EXCEPTION 'Selective recovery modified an unrelated table or missed a selected observation';
  END IF;
END $$;
SQL
if grep -q '"event":"player_recovery_receipt"' "$TEMP/mismatch.log"; then
  echo "Identity mismatch produced a receipt without attestation" >&2; exit 1
fi
# The stdout receipts must identify exactly the persisted rows from each
# invocation, including the two independently failed attempts in the combined run.
for selection in injuries sleeper both; do
  receipt=$(grep '^{"event":"player_recovery_receipt"' "$TEMP/$selection.log")
  if [ "$(printf '%s\n' "$receipt" | wc -l)" -ne 1 ]; then
    echo "Expected one receipt for $selection" >&2; exit 1
  fi
  key=$(printf '%s\n' "$receipt" | node -e '
    let input = ""; process.stdin.on("data", part => input += part);
    process.stdin.on("end", () => {
      const r = JSON.parse(input);
      const expected = process.argv[1] === "both" ? ["injuries", "sleeper"] : [process.argv[1]];
      if (r.status !== "failed" || r.target !== "attested_disposable_development_primary"
        || JSON.stringify(r.approvedFeeds) !== JSON.stringify(expected)
        || JSON.stringify(r.attempts.map(a => [a.feed, a.status, a.reason]))
          !== JSON.stringify(expected.map(feed => [feed, "failed", "sync_error"])))
        process.exit(1);
      process.stdout.write(r.syncRunJobKey);
    });' "$selection")
  count=$(psql "$URL" -At -v key="$key" <<'SQL'
SELECT count(*) FROM data_sync_runs WHERE job_key=:'key' AND status='failed';
SQL
)
  expected=1
  if [ "$selection" = both ]; then expected=2; fi
  if [ "$count" != "$expected" ]; then echo "Receipt does not match selected sync runs" >&2; exit 1; fi
done
# Exercise each selected adapter, then prove that a repeat response is fresh
# metadata without a duplicate observation, and that A-B-A changes are retained.
run injuries initial > "$TEMP/success-injuries.log" 2>&1
run sleeper initial > "$TEMP/success-sleeper.log" 2>&1
run injuries,sleeper initial > "$TEMP/success-repeat.log" 2>&1
run injuries,sleeper changed > "$TEMP/success-changed.log" 2>&1
run injuries,sleeper initial > "$TEMP/success-return.log" 2>&1
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  injury_runs integer[];
  sleeper_runs integer[];
BEGIN
  SELECT array_agg(records_processed ORDER BY id) INTO injury_runs
  FROM data_sync_runs WHERE provider='espn-injuries' AND status='success';
  SELECT array_agg(records_processed ORDER BY id) INTO sleeper_runs
  FROM data_sync_runs WHERE provider='sleeper-players' AND status='success';
  IF injury_runs IS DISTINCT FROM ARRAY[1,0,1,1]
    OR sleeper_runs IS DISTINCT FROM ARRAY[1,0,1,1]
    OR (SELECT count(*) FROM data_sync_runs) <> 12
    OR (SELECT count(*) FROM data_sync_runs WHERE status='failed') <> 4
    OR (SELECT count(*) FROM data_sync_runs WHERE status='success'
        AND job_key LIKE 'operator-player-recovery:%' AND completed_at IS NOT NULL
        AND error_message IS NULL) <> 8
    OR (SELECT count(*) FROM injuries WHERE player_id='synthetic-athlete'
        AND team_id='synthetic-team' AND injury='Ankle' AND practice_status='Limited') <> 3
    OR (SELECT count(DISTINCT source_hash) FROM injuries) <> 2
    OR (SELECT count(*) FROM players WHERE player_id='synthetic-athlete'
        AND name='Fixture Runner' AND active_status='Questionable') <> 1
    OR (SELECT count(*) FROM sleeper_player_snapshots
        WHERE sleeper_player_id='synthetic-sleeper' AND team='ARI'
        AND position='RB' AND provider_ids->>'espn_id'='synthetic-athlete') <> 3
    OR (SELECT count(DISTINCT source_hash) FROM sleeper_player_snapshots) <> 2
    OR (SELECT count(*) FROM data_sync_runs WHERE provider='espn-injuries'
        AND status='success' AND metadata->>'observationKind'='injury-only'
        AND metadata->>'responseComplete'='true'
        AND metadata->>'publicationProvenance'='payload'
        AND metadata->>'publicationAt'='2026-09-20T12:00:00.000Z'
        AND (metadata->>'observedCount')::int=1
        AND (metadata->>'groupCount')::int=1
        AND (metadata->>'unchanged')::int=1) <> 1
    OR (SELECT count(*) FROM data_sync_runs WHERE provider='sleeper-players'
        AND status='success' AND (metadata->>'playerCount')::int=1
        AND (metadata->>'teamCount')::int=1
        AND metadata->'teams'='["ARI"]'::jsonb
        AND (metadata->>'depthOrderCount')::int=1
        AND (metadata->>'unchanged')::int=1
        AND metadata->>'snapshotId' IS NOT NULL
        AND metadata->>'sourceCapturedAt' IS NOT NULL) <> 1
    OR (SELECT count(*) FROM scheduler_jobs) <> 0
    OR (SELECT count(*) FROM sportsbook_odds) <> 0
    OR (SELECT count(*) FROM odds_api_requests) <> 0
    OR (SELECT count(*) FROM odds_event_audits) <> 0
    OR (SELECT count(*) FROM market_baseline_runs) <> 0
    OR (SELECT count(*) FROM market_baseline_events) <> 0
    OR (SELECT count(*) FROM market_baseline_quotes) <> 0
    OR (SELECT count(*) FROM model_versions) <> 0
    OR (SELECT count(*) FROM model_training_runs) <> 0
    OR (SELECT count(*) FROM model_evaluation_predictions) <> 0
    OR (SELECT count(*) FROM model_promotion_history) <> 0
    OR (SELECT count(*) FROM predictions) <> 0
    OR (SELECT count(*) FROM prediction_snapshots) <> 0
    OR (SELECT count(*) FROM depth_chart_snapshots) <> 0
    OR (SELECT count(*) FROM usage_analytics_events
        WHERE event_name='disposable-retention-sentinel') <> 1
    OR (SELECT count(*) FROM usage_analytics_events) <> 1
    OR (SELECT count(*) FROM usage_analytics_retention
        WHERE id=1 AND last_attempt_status='sentinel') <> 1
    OR (SELECT count(*) FROM usage_analytics_retention) <> 1
    OR (SELECT count(*) FROM recovery_forbidden_writes) <> 0
  THEN RAISE EXCEPTION 'Successful selective recovery missed observations/metadata or modified unrelated state';
  END IF;
END $$;
SQL
echo "Disposable selective recovery passed: blocked and synthetic success cases, change-only observations, provider metadata, unrelated state unchanged."
