# Premium Consumer Trust Pass

## Verification target

- Season 2026, Week 2
- DET at BUF (`401872932`)
- Games: `/games?season=2026&week=2`
- Game Detail: `/games/401872932?season=2026&week=2`

## Read-only consumer fields and persisted sources

- `matchup.home.logoUrl` and `matchup.away.logoUrl`: team identity rows in `teams`
- `teamRecords` and `recordVerification`: final-status regular-season rows in `games`; scheduled/live 0–0 values are excluded
- `marketBoard.status`, `staleAfterMinutes`, and each comparison's `state`, timestamps, age, and `freshnessLabel`: persisted `sportsbook_odds` observations from DraftKings and FanDuel
- `marketBoard.comparisons[].firstObserved` and `.current`: earliest and current persisted Gridline observations for the selected canonical sportsbook stream
- `movement.streams[].firstObserved`, `.current`, and `.finalPreKickoff`: complete persisted sportsbook chronology; the UI does not call these sportsbook openers or closes
- Game Detail personnel context: verified current depth/injury evidence from the existing current-personnel service, with explicit source, freshness, confidence, conflict, partial, and unavailable states
- `prediction` and model timestamps: existing immutable `prediction_snapshots`; no consumer request starts prediction computation

## QA results

- API consumer/evidence suite: 42 passed
- Consumer presentation suite: 3 passed
- API Server TypeScript check: passed
- NFL Analytics TypeScript check: passed
- Workflow restart: API and web workflows running cleanly
- DET–BUF API verification: matchup returned for 2026 Week 2 with stale market state and verified entering records
- Responsive review: Games at 390px and Game Detail at 320px show no page-level horizontal overflow
- Trust copy review: no user-selection claim for the canonical market quote; input quality, market freshness, model difference, and research strength are visually distinct
- Movement review: price-only and A-B-A observations remain intact in API coverage
- Unavailable review: absent projection, market, personnel, and logo states render explicit fallbacks

## Screenshots

- `screenshots/task-153-games-desktop.jpg`
- `screenshots/task-153-games-mobile.jpg`
- `screenshots/task-153-detail-desktop.jpg`
- `screenshots/task-153-detail-mobile-320.jpg`
- `screenshots/task-153-detail-mobile-390.jpg`

## Change boundary

This pass changes read-only consumer contract/presentation behavior only. It does not change database mutation behavior, workers, schedules, model training or inference, prediction calculations, sportsbook calculations, depth inference, persistence behavior, production data, or Phase 6.1 behavior.