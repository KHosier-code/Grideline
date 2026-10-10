#!/usr/bin/env bash
# Unit tests run on every pull request (.github/workflows/ci.yml). Run it
# locally from the repo root after `pnpm install`: bash scripts/ci-tests.sh
#
# Only tests that need no database or network are listed. Left out for now:
# tests that need a live Postgres (odds-reconciliation, usage-analytics-retention,
# verified-imagery-db, dashboard, consumer-schedule-performance, ...) and tests
# written for the retired Gridline worker and pages whose fixtures went stale
# (current-personnel, sleeper-identity-mapping, consumer-red-zone, ...).
# Add a test here once it passes on its own.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://ci:ci@127.0.0.1:1/ci}"

echo "::group::Build API (bundles its tests)"
pnpm --filter @workspace/api-server run build
echo "::endgroup::"

API_TESTS=(
  availability-roster consumer-market-freshness consumer-matchups consumer-player-eligibility
  consumer-source-health current-personnel-derivation defense-vs-position
  feed-schedule game-alert-detection game-state kickoff-clock nflverse-player-stats
  nflverse-week2-refresh odds.fixtures personnel-context-derivation
  player-forecast-readiness player-position-evaluation player-position-matchup
  player-td-forecast-readiness player-td-model player-upcoming red-zone-opportunities
  scheduler sleeper touchdown-board user-picks pick-grading game-projections
  stadiums team-fixture-verification consumer-team-analytics verified-imagery
 worker-ownership worker-rehearsal player-feed-recovery player-projections
)
ROUTE_TESTS=(authorization usage-analytics)
WEB_TESTS=(
  analytics consumer-account-state consumer-board consumer-matchups consumer-presentation
  dvp-matchups line-picks line-shopping market parlay pick-sheet player-portraits
  player-slug pool-strategy sim slates
)

files=()
for name in "${API_TESTS[@]}"; do
  out="artifacts/api-server/dist/lib/$name.test.mjs"
  [ -f "$out" ] || (cd artifacts/api-server && pnpm exec esbuild "src/lib/$name.test.ts" --bundle --platform=node \
    --format=esm --packages=external --outfile="dist/lib/$name.test.mjs" --log-level=warning)
  files+=("$out")
done
for name in "${ROUTE_TESTS[@]}"; do files+=("artifacts/api-server/dist/routes/$name.test.mjs"); done
for name in "${WEB_TESTS[@]}"; do
  (cd artifacts/api-server && pnpm exec esbuild "../nfl-analytics/src/lib/$name.test.ts" --bundle --platform=node \
    --format=esm --packages=external --alias:@=../nfl-analytics/src --outfile="dist/web-tests/$name.test.mjs" --log-level=warning)
  files+=("artifacts/api-server/dist/web-tests/$name.test.mjs")
done

echo "::group::Unit tests"
node --test "${files[@]}" \
  artifacts/nfl-analytics/tests/metadata.test.mjs \
  artifacts/nfl-analytics/tests/performance-sparse-evidence.test.mjs
echo "::endgroup::"
