# NFL Analytics Model

Personal NFL analytics workspace for live schedule data, sportsbook readiness, historical snapshots, and transparent model evaluation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — canonical full typecheck; rebuilds shared-library declarations once before checking artifacts
- `pnpm --filter @workspace/api-server run typecheck` — targeted API check; its `pretypecheck` hook rebuilds shared database and API-contract declarations first
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/nfl-analytics` — responsive React/Vite product UI and route-level screens.
- `artifacts/api-server/src/lib/espn.ts` — ESPN adapter with parsing, retry timeout, and in-memory freshness cache.
- `artifacts/api-server/src/lib/nflverse.ts` — NFLverse historical-data adapter boundary and readiness status.
- `artifacts/api-server/src/routes` — API route handlers for dashboard, data health, games, teams, and settings.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts; run codegen after changes.
- `lib/db/src/schema` — normalized PostgreSQL/Drizzle schema for NFL entities, immutable snapshots, predictions, model versions, and settings.

## Architecture decisions

- Live ESPN schedule/team data is cached briefly and persisted to PostgreSQL so the UI can fall back to the last successful capture.
- Model outputs stay unavailable until a trained model is actually promoted; empty and not-trained states are intentional.
- Sportsbook history uses append-only timestamped rows, while settings are the only mutable singleton configuration.
- Secret values remain server-side; the frontend receives only safe configuration status such as whether `ODDS_API_KEY` is present.

## Product

The current release provides a professional dashboard, live current-week slate, game detail route, provider data-health monitor, sportsbook/model configuration, and honest readiness pages for odds, line movement, injuries, depth charts, backtesting, model lab, and performance.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do not populate fabricated probabilities, edges, records, or odds. Use the explicit not-trained/not-configured states until source data and validated models exist.
- Update `lib/api-spec/openapi.yaml` before changing API consumers, then run `pnpm --filter @workspace/api-spec run codegen`.
- Use the managed API and web workflows rather than starting root-level development servers.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
