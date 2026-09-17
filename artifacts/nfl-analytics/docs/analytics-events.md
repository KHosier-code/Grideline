# Custom analytics events

Replit Project Analytics injects the Umami tracker into published website artifacts. The shared wrapper in `src/lib/analytics.ts` treats a missing or failing tracker as a no-op so analytics cannot interrupt Usage Lab interactions.

The same bounded Usage Lab payload is copied to the application database for the administrator report at `/admin/usage-analytics`. That report uses a rolling seven-day period. Collection failures are non-blocking and do not affect the consumer interaction.

No event includes player names, player IDs, game IDs, user-entered text, or other free-form values.

## Player Usage Lab

| Description | Event name | Properties |
| --- | --- | --- |
| A team, position, window, or game-context filter changed | `usage_filter_changed` | `filter`: `team`, `position`, `window`, or `game`; `value`: an available team abbreviation, `QB`, `RB`, `WR`, `TE`, a supported window, `all`, or `specific_game` |
| The table sort changed | `usage_sort_changed` | `column`: one of the table's fixed sortable columns; `direction`: `asc` or `desc` |
| A player evidence row was expanded or collapsed | `usage_row_toggled` | `action`: `expand` or `collapse`; `position`: fixed NFL position; `trend`: `up`, `down`, `flat`, or `unavailable`; `coverage`: `complete` or `partial`; `window`: supported usage window |
| Filters and table state were reset | `usage_filters_reset` | `had_team`, `had_position`, and `had_game`: booleans; `window`: the supported window active before reset |

## Suggested funnel queries

- Compare `usage_filter_changed` by `filter` with later `usage_row_toggled` events to see which filters lead to evidence inspection.
- Group expanded `usage_row_toggled` events by `position`, `trend`, `coverage`, and `window` to learn which evidence states users inspect.
- Compare `usage_sort_changed` by `column` and `direction` with later row expansions to identify useful ranking paths.