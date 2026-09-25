# GL-002 integrated consumer release review

## Candidate boundary

- Branch: `gl002-consumer-integrated-review`, created directly from published GL-002 commit `b9b44fce38744fc43042dd3a40e0e4ec3a3b88ee`.
- This candidate combines bounded personnel, Games, and detail changes with the Home/public-navigation update and integration repairs. Source-branch ancestry was not merged. No QB-challenger or GL-003 commit is an ancestor of this branch.
- No production data, schema, model promotion, or Publish operation was performed.

## Included behavior

- Home leads with upcoming schedule matchups; Home and Games are the primary public destinations. Signed-out visitors can view Home, Games, and detail, and can reach Sign in. Signed-in users retain Open dashboard, while the Admin route remains guarded. Unfinished routes remain registered for signed-in users but are absent from primary navigation. Feed status is collapsed.
- Games selects a live, upcoming, or recent slate from persisted schedule dates. Rows distinguish official final scores, saved projections, verified official pregame predictions, and eligible market comparisons. Ineligible quotes are evidence only. Feed status and team records start collapsed.
- Personnel presents supported offensive roles and scheme-neutral defensive groupings, with availability, confidence, and source time. Unconfirmed identities stay unconfirmed. An unknown modeled QB identity is stated explicitly; live personnel does not rewrite a saved score.
- Detail leads with matchup and saved projection, explains independent spread/totals/moneyline model families, gates market comparisons, and labels historical prices as observations rather than verified sportsbook closes. Diagnostics are available in disclosures.

## Verification

- API and web typechecks and builds: passed. Web build produced non-fatal bundle-size and source-map warnings.
- Focused consumer API/matchup tests: 49 passed. Consumer board/presentation tests: 8 passed. Admin middleware tests: 5 passed; authorization route tests: 3 passed. Current-personnel tests: 21 passed.
- Preview API: schedule selection returned 2026 Week 3 (`live`); Washington–Seattle detail returned HTTP 200. Home, Games, and detail rendered at desktop (1440 × 900) and mobile (390 × 844) without browser-console errors.
- Washington–Seattle arithmetic is **fixture-based** in the consumer API tests: saved home margin −0.7257358100211451 and total 44.954963921603145 yield WSH 22.1146 and SEA 22.8403; the independent moneyline model yields SEA 65.6756% win probability. The saved snapshot was not modified and is not marked an official final prediction.

## Screenshots

| View | Desktop | Mobile |
| --- | --- | --- |
| Home | `screenshots/gl002-candidate-home-desktop.jpg` | `screenshots/gl002-candidate-home-mobile.jpg` |
| Games | `screenshots/gl002-candidate-games-desktop.jpg` | `screenshots/gl002-candidate-games-mobile.jpg` |
| Washington–Seattle detail | `screenshots/gl002-candidate-detail-desktop.jpg` | `screenshots/gl002-candidate-detail-mobile.jpg` |

## Release decision items

- Development does not have the production-model Washington–Seattle snapshot. Its preview correctly says the projection is updating; the saved-score/probability copy was checked with fixtures, not a live browser record. Verify the published snapshot display in release review before approving Publish.
- The development board reported stale feeds and 0 of 16 eligible comparisons at capture time. The UI correctly withholds comparisons; feed readiness and current market availability need separate operational review.
- This is a review candidate only. Publishing requires an explicit later decision.