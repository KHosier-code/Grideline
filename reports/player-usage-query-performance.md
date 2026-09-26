# Player Usage Lab query plans — development, 2026-09-26

## Scope and repeatable measurement

The development database contained 44,270 player-game rows and 134,108 snap rows across seasons at measurement time. The largest player-game season, 2025, had 19,400 rows; 2025 snap counts had 26,612 rows. After applying `0040_player_usage_lookup_indexes.sql` in development, I ran `EXPLAIN (ANALYZE, BUFFERS)` on representative 2025 New England reads. The baseline selected the full team's season (`season = 2025 AND team_id = 'NE'`); the scoped read selected eight exact `(week, team_id, opponent_team_id)` tuples for weeks 1–8, with the same season predicate. Queries selected all table columns to approximate the route's player-game read. These are database execution times, not HTTP latency or end-to-end response times. A warm cache and different row counts will change timings.

| Read | Rows returned | Plan | Shared buffers | Execution time |
| --- | ---: | --- | ---: | ---: |
| Player-game, full NE season | 731 | Index Scan, `player_game_stats_usage_matchup_idx` | 339 hits | 3.264 ms |
| Player-game, eight NE matchups | 285 | Bitmap Heap Scan + BitmapOr on `player_game_stats_usage_matchup_idx` | 165 hits | 0.363 ms |
| Snaps, full NE season | 987 | Index Scan, `snap_counts_usage_matchup_idx` | 40 hits, 4 reads | 1.314 ms |
| Snaps, eight NE matchups | 378 | Bitmap Heap Scan + BitmapOr on `snap_counts_usage_matchup_idx` | 31 hits | 0.187 ms |

The scoped plans use the composite indexes with conditions on **season, team, week, and opponent** for each tuple, rather than fetching an entire season and dropping unmatched games in Node. The schedule read has a `(season, kickoff_time)` index; the player identity lookup retains its existing GSIS index. The two-game Game Detail path further restricts source rows to the selected matchup's teams. An unfiltered Lab request still needs all *eligible* completed games in the selected season to preserve player inclusion, team target denominators, and rolling-window coverage; it is not equivalent to an eight-game team request.

To reproduce the targeted plan (replace the tuple list with a cutoff-safe team's actual completed opponents):

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM player_game_stats
WHERE season = 2025
  AND (week, team_id, opponent_team_id) IN
    ((1,'NE','LV'),(2,'NE','MIA'),(3,'NE','PIT'),(4,'NE','CAR'),
     (5,'NE','BUF'),(6,'NE','NO'),(7,'NE','TEN'),(8,'NE','CLE'));
```

The same shape applies to `snap_counts`. The Lab only falls back to season-scoped source chronology when no schedule rows exist at the requested cutoff; it marks that case partial. Source game IDs are not interchangeable with schedule or snap game IDs, so the source read uses the eligible schedule's normalized team/opponent/week pairs instead.