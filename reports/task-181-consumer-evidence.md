# Consumer game-detail evidence review

## Confirmed bugs versus presentation issues

- **Confirmed boundary bug:** Movement serialization supplied `finalPreKickoff` even while kickoff was still in the future. It now leaves that field null until kickoff has passed. The UI calls the resulting historical observation “Last recorded pre-kickoff,” never a verified sportsbook close. First-observed, latest recorded, price-only changes and A–B–A history remain distinct.
- **Presentation issues:** Feed timestamps appeared before the teams; three placeholder market quotes and a board marked partial/stale could imply a usable comparison even when every market was ineligible; unsupported matchup categories filled the page. The layout now leads with teams and saved projection, collapses feed diagnostics and unusable markets, and omits unsupported assessments with a count and limitation.
- **Not a calculation or side-mapping defect:** Read-only production snapshot for 2026 Week 3, game `401872955`, has Washington home, Seattle away, home margin **−0.7257358100211451**, total **44.954963921603145**, Washington win probability **0.3432441400949979**. `(total + home margin)/2 = WSH 22.114614055791`; `(total − home margin)/2 = SEA 22.840349865812144`. SEA win probability is `1 − home probability = 65.6755859905%`. The score uses the saved spread and totals model versions (`phase6-1-spread-01c85917b47c6e70c258fe02`, `phase6-1-totals-749279b5856f1be1165c211d`); win probability uses the separate moneyline version (`phase6-1-moneyline-917fa6e7417cccb45909ade4`). This snapshot's `official_final_prediction` is false; it must not be described as a verified official pregame prediction. No model or saved values were changed.

The local development database currently has no eligible production-model snapshot for that game, so the development preview honestly shows “Projection is updating.” The production snapshot was inspected read-only; no production write, publish, or GL-003 merge was made.

## Screenshots

- Before: `screenshots/task-181-before.jpg` (the first immediate capture caught the loading state); `screenshots/task-100-game-detail-final.jpg` is an existing fully loaded pre-change detail reference showing feed diagnostics ahead of the teams and unsupported categories filling the board.
- After: `screenshots/task-181-after.jpg` (fully loaded Washington–Seattle development detail, matchup and unavailable projection first, no eligible comparison).

## Changed files and checks

- API and contract: `artifacts/api-server/src/routes/consumer.ts`, `artifacts/api-server/src/routes/consumer.test.ts`, `lib/api-spec/openapi.yaml`, generated client/Zod contract files under `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.
- UI: `artifacts/nfl-analytics/src/pages/consumer/ConsumerGameDetail.tsx`, `artifacts/nfl-analytics/src/components/ConsumerProjectionEvidence.tsx`, `ConsumerMarketEvidence.tsx`, `ConsumerMarketComparison.tsx`, `ConsumerSourceHealth.tsx`, `ConsumerMatchupBoard.tsx`, `LineMovementExperience.tsx`, `src/lib/consumer-presentation.ts`, its test, and `src/index.css`.
- Checks: API and web typechecks passed; 11 focused API tests passed; 5 consumer presentation tests passed; API response returned HTTP 200 and both preview workflows started without browser console errors. The Washington–Seattle arithmetic fixture tests the persisted values; the UI tests guard all-ineligible, partial, stale and historical gating, unsupported assessments, and future movement labeling.