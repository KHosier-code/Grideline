#!/bin/bash
set -Eeuo pipefail
pnpm install --frozen-lockfile
GRIDLINE_MIGRATION_ENV=development pnpm --filter @workspace/scripts run db:migrate
