# Gridline Player Usage on the published website — release preparation

**Date:** 2026-09-25  
**Status:** **FRONTEND FIX READY** — the code is corrected in development but **has not been published**. The existing production site is not yet fixed.

## Root cause and deployed identity

The published API and 2026 data are present. The full **Usage & Production** page existed in the published frontend, but its route was registered **only for signed-in visitors**, and the public header/mobile navigation linked only **Home** and **Games**. A signed-out visit to `/usage` did not mount the usage page; in a headless public browser its rendered DOM contained only the application shell/metadata. Thus visitors had no route or navigation entry to the full Player Usage table. This is a **frontend route/discoverability defect**, not an import failure.

The published **Game Detail** page is a different, limited view. It does mount **Key player usage** below multiple earlier sections; that section appears in the rendered public desktop and mobile DOM for SEA at WSH, with Jaxon Smith-Njigba and Drew Lock. It is easy to miss near the top of a long page and is not the full searchable Player Usage table. The published **Games** board shows matchup rows and a link to Game Detail, not an inline Player Usage table.

Deployment identity was established before changing code:

- `getDeploymentInfo()` reports a public, successful VM deployment at `https://gridelineanalytics.com`.
- Production startup logs at **17:22:47 UTC** identify build `e0f96a4ec791-2026-09-25T17:20:24.972Z`; the read-only production `release_security_evidence` row records the same build and passed startup verification. The matching local repository commit `e0f96a4ec791b75b81c2cf0c8b120696dbc78734` exists. This identifies the API build; it does not on its own prove frontend contents.
- The actual public `/games` and `/games/401872955` pages serve `/assets/index-CRbxfSMP.js`. Inspecting **that downloaded published asset**, not just local source, confirms the `Key player usage` component, `/games/:gameId` route, `/api/consumer/player-usage` client route, and `/usage` route string. The active source corresponding to that release contains the complete usage page and Game Detail integration; its signed-out router lacks `/usage`. The earlier frontend Game Detail integration is present by commit `520e15f`, and the 2026 API importer work by `0531704`/`e0f96a4` is included in the published ancestor. The working tree before repair was `a616638d89435c5bf4204d424acf5651fcefd76b`; intervening commits after `e0f96a4` were documentation/verification, not a newer published UI fix.
- Public browser evidence: `/games` rendered a board and **no Player Usage link**; `/games/401872955` rendered the Game Detail including `premium-key-players`, Jaxon and Drew, on desktop and mobile. A signed-out public `/usage` rendered no Player Usage content. No app-level console or network error was needed to explain this: the router never mounted the page. Authenticated production paths were not accessed or bypassed.

## Production data-to-screen trace

Read-only GETs against the published production site remain successful. The generated client uses same-origin `GET /api/consumer/player-usage`, and `ConsumerUsage` calls `useGetConsumerPlayerUsage` with team, position, game, and window filters. Game Detail independently uses `useGetConsumerGame` for `/api/consumer/games/:gameId`; the API produces `keyPlayers` from eligible recent player-game rows. The mounted `ConsumerKeyPlayers` component renders that **selected subset**, not all players returned by the full usage endpoint.

| Verified example | Public usage endpoint (`window=last3`) | Corresponding Game Detail |
| --- | --- | --- |
| Seattle WR | SEA WR `partial`: Cooper Kupp, Rashid Shaheed, Jaxon Smith-Njigba, Montorie Foster Jr. Jaxon has 22 targets and 277 receiving yards in completed weeks 1–2. | Future SEA at WSH `401872955` has Jaxon with 22 targets/277 yards in `keyPlayers`; the others are not guaranteed to be among the selected top five. |
| Seattle QB | `partial`: Sam Darnold has only a week-1 row; Drew Lock has weeks 1–2. | SEA at WSH includes Drew (2 carries/13 yards), not Sam. Missing appearances are not fabricated. |
| Cleveland RB | `partial`: Quinshon Judkins (24 carries, 54 rush yards, 7 targets), Dylan Sampson, Raheim Sanders, Jaleel McLaughlin. | CAR at CLE `401872949` includes **no RB** in `keyPlayers`: server selection ranks all positions by snap share, takes five per team, and its Cleveland top five are QB/linemen. This is a limitation of the *Key players* subset, not absent RB records; the full `/usage` table will expose them after the frontend route is published. This task does not change the separate Game Detail selection policy. |
| Kansas City QB | `available`: Patrick Mahomes, two completed team games, 9 carries/40 rush yards/1 TD. | KC at MIA `401872952` includes Mahomes with 9 carries. |

Game-filtered usage excludes the future SEA–WSH contest from historical games. Unsupported red-zone/explosive metrics remain unavailable rather than guessed. The production `player-usage-games` GET also returns 2026 game context choices. No API-route or generated-client mismatch was found.

## Component and state checks

- `ConsumerKeyPlayers` is exported, imported, and unconditionally mounted within a successfully loaded Game Detail. A projection or sportsbook market is **not a condition** for mounting it; absent metrics use the existing unavailable state. A public completed SEA–ARI game `401872943` returned Game Detail HTTP 200, player usage and a `stale` market board. Upcoming SEA–WSH returned HTTP 200 and player usage. A live no-projection Game Detail fixture was not found in the sampled games, so independence from predictions is confirmed by component/route structure, **not** by a production no-projection browser example.
- The full Player Usage component already has loading, unavailable/empty, partial-coverage, filter, and zero-denominator handling. No feature flag suppresses it. The API is public; this change does **not** expose an admin endpoint or alter Clerk configuration.
- Desktop and mobile published Game Detail DOM contain the key-player section. The development full page was visually checked at **1440×900** and **390×844** signed out: desktop navigation shows **Player Usage**, and the mobile page and filters fit the viewport. On mobile its navigation is behind the existing menu button, populated from the same `consumerNav` entries. The development database has no matching 2026 player-game records, so the development page correctly shows **No players found**. **A populated full-page browser render cannot be validated against development data without importing data; no import was performed.** The verified production GETs establish the expected populated input, but the post-publish rendered full page remains to be checked.

## Development-only fix and verification

**Expected frontend fix commit:** `3d43428111f57f3f8f7e9d7c4b578a3c14bbfd80` (`Expose Player Usage to public Gridline visitors`). It adds `/usage` to signed-out routing and adds **Player Usage** to the shared desktop/mobile consumer navigation. The signed-in `/usage` route and existing page/client/API remain unchanged. Changed files:

- `artifacts/nfl-analytics/src/App.tsx`
- `artifacts/nfl-analytics/src/lib/consumer-usage.test.ts` (regression check for public navigation and routing)

Validation completed:

- Frontend `typecheck`: **pass**.
- Frontend consumer presentation/usage tests, using the repository-supported Node TypeScript runner: **12 passed**. The initial `vitest` command was unavailable (`vitest` is not installed); no dependency was installed.
- Applicable API consumer tests (`test:consumer-matchups`): **49 passed**.
- Frontend production `vite build`: **pass** (non-fatal sourcemap-location and large-chunk notices).
- Development web workflow restarted once and came up cleanly; direct browser preview and 2026 production GET checks above passed.
- Static and live checks cover supported positions, partial/empty data, completed/upcoming games, and missing/stale market handling. **No test claims a populated development table or live Game Detail lacking a projection.**

## Exactly what to do next

1. **Publish the main project containing commit `3d43428111f57f3f8f7e9d7c4b578a3c14bbfd80`** through Replit's Publish interface. Check that the frontend build from this commit succeeds and the published JavaScript asset changes from `index-CRbxfSMP.js`; do not run the import, change database bindings, or migrate data.
2. In a fresh **signed-out** desktop browser, open `https://gridelineanalytics.com/usage` and follow the new **Player Usage** navigation item from Games. The page should show real 2026 players. Filter SEA WR/QB, CLE RB, and KC QB; verify the names and week-1/2 metrics above, partial states, and unavailable metric indicators.
3. Repeat on mobile: open the menu, select **Player Usage**, use team/position filters, and verify the table/expanded player details remain usable. Check Game Detail `401872955` and completed `401872943` for the existing Key player usage section below the projection/context sections. Inspect browser console and failed requests if anything remains blank.
4. Confirm the new published frontend asset and successful deployment build ID **after** publishing. Until these post-publish checks succeed, describe this as a **ready development fix**, not a repaired production website.

No production data modification, import, sync trigger, migration, database-binding change, deployment, model action, or sportsbook-history change was performed.

**FINAL STATUS: FRONTEND FIX READY**