# Game-day availability evidence

Player-position count and yard forecasts remain withheld by their separate model,
coverage, and holdout gates. ESPN team rosters are **not** game rosters; its
injury-only feed cannot clear an omitted player.

The operator-reviewed capture command archives the actual HTML from an official
NFL article/report, its SHA-256 digest, publisher, URL, publication time from
publisher metadata, fetch observation time, the exact game/player passages, GSIS
and ESPN identity, team, game, and affirmative assertion. It accepts only an
explicit active-for-this-game statement for game-roster evidence and an explicit
cleared-to-play statement for injury clearance. A practice clearance, inactive
list omission, projected lineup, generic team roster, or undated page is not
enough. The two assertions must come from different documents. The importer
checks the upcoming schedule and crosswalk; an operator must still review the
entire publisher page, including surrounding qualifications and whether its
statements refer to this particular player and game, before submitting it.

Prepare a JSON array containing one entry per distinct source, for example:

```json
[
  {
    "kind": "game-roster",
    "sourceUrl": "https://www.nfl.com/news/<published-active-roster-article>",
    "gameId": "<schedule game ID>",
    "team": "<canonical abbreviation>",
    "playerId": "<GSIS ID>",
    "playerName": "<nflverse display name>",
    "gameExcerpt": "<verbatim visible passage containing both full team names>",
    "playerExcerpt": "<verbatim visible passage naming the player and affirming active for the game>"
  },
  {
    "kind": "injury-clearance",
    "sourceUrl": "https://www.nfl.com/news/<published-clearance-article>",
    "gameId": "<same schedule game ID>",
    "team": "<same abbreviation>",
    "playerId": "<same GSIS ID>",
    "playerName": "<same nflverse display name>",
    "gameExcerpt": "<verbatim visible passage containing both full team names>",
    "playerExcerpt": "<verbatim visible passage naming the player and affirming cleared to play>"
  }
]
```

Then run `pnpm --filter @workspace/api-server capture:game-availability -- /path/to/reviewed-captures.json`
from a trusted operator shell with database access. Each source is fetched at
execution time and archived append-only, including repeated observations of
unchanged pages. Game-roster captures must occur within 24 hours of kickoff.
Do not reuse a page that was updated
after the desired cutoff to reconstruct historical pregame knowledge: no
backdating is supported. If either publisher page cannot be verified before
kickoff, keep eligibility unavailable. No examples above are real assertions.