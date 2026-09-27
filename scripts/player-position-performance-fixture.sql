-- Synthetic 17-week, 32-team regular season. Never run against an inherited URL.
INSERT INTO teams (team_id, abbreviation, team_name)
SELECT 'fixture-' || n, CASE n WHEN 1 THEN 'KC' WHEN 2 THEN 'LAR' ELSE 'T' || n END,
       'Fixture Team ' || n
FROM generate_series(1, 32) n;

INSERT INTO nflverse_source_files (dataset, season, source_url, status, completed_at)
VALUES ('player_stats', 2025, 'fixture://weekly', 'success', '2026-09-01'),
       ('pbp', 2025, 'fixture://pbp', 'success', '2026-09-01');

CREATE TEMP TABLE fixture_games AS
SELECT week, game_number, 'fixture-game-' || week || '-' || game_number AS game_id,
       ((2 * game_number + week - 3) % 32) + 1 AS home,
       ((2 * game_number + week - 2) % 32) + 1 AS away
FROM generate_series(1, 17) week CROSS JOIN generate_series(1, 16) game_number;

INSERT INTO games (game_id, season, week, game_date, kickoff_time, home_team_id, away_team_id, game_status)
SELECT game_id, 2025, week, '2025-09-01'::timestamptz + week * interval '7 days',
       '2025-09-01'::timestamptz + week * interval '7 days',
       'fixture-' || home, 'fixture-' || away, 'STATUS_FINAL'
FROM fixture_games;

CREATE TEMP TABLE fixture_sides AS
SELECT game_id, week, home AS team, away AS opponent FROM fixture_games
UNION ALL
SELECT game_id, week, away, home FROM fixture_games;

INSERT INTO player_game_stats
  (player_id, player_name, position, team_id, opponent_team_id, season, week, season_type,
   targets, receptions, receiving_yards, receiving_tds, carries, rushing_yards, rushing_tds,
   attempts, passing_yards, passing_tds, interceptions, source_updated_at)
SELECT 'fixture-player-' || side.team || '-' || slot,
       'Fixture Player ' || side.team || '-' || slot,
       CASE WHEN slot <= 8 THEN 'WR' WHEN slot <= 16 THEN 'RB'
            WHEN slot <= 20 THEN 'TE' WHEN slot <= 22 THEN 'QB' ELSE 'OL' END,
       CASE WHEN side.team = 1 AND slot = 1 THEN ' kc ' ELSE 'fixture-' || side.team END,
       'fixture-' || side.opponent, 2025, side.week, 'REG',
       CASE WHEN side.team = 1 AND side.week = 17 AND slot = 1 THEN NULL ELSE slot % 8 + 1 END,
       slot % 5, (slot % 5) * 11, slot % 2, slot % 6, slot * 2,
       slot % 2, slot % 9, slot * 4, slot % 2, slot % 2, '2026-09-01'
FROM fixture_sides side CROSS JOIN generate_series(1, 30) slot;

INSERT INTO red_zone_team_game_facts
  (game_id, source_game_id, season, week, season_type, team_id, opponent_team_id, zone, targets, carries, ingested_at)
SELECT game_id, game_id, 2025, week, 'REG', 'fixture-' || team,
       'fixture-' || opponent, zone, 5, 5, '2026-09-01'
FROM fixture_sides CROSS JOIN (VALUES (10), (20)) z(zone);

INSERT INTO red_zone_player_game_facts
  (game_id, source_game_id, season, week, season_type, player_id, player_name, position,
   team_id, opponent_team_id, zone, targets, carries, ingested_at)
SELECT game_id, game_id, 2025, week, 'REG', 'fixture-player-' || team || '-' || slot,
       'Fixture Player ' || team || '-' || slot,
       CASE WHEN slot <= 8 THEN 'WR' WHEN slot <= 16 THEN 'RB'
            WHEN slot <= 20 THEN 'TE' WHEN slot <= 22 THEN 'QB' ELSE 'OL' END,
       'fixture-' || team, 'fixture-' || opponent, zone, slot % 3, slot % 2, '2026-09-01'
FROM fixture_sides CROSS JOIN generate_series(1, 30) slot
  CROSS JOIN (VALUES (10), (20)) z(zone);

ANALYZE games;
ANALYZE player_game_stats;
ANALYZE red_zone_team_game_facts;
ANALYZE red_zone_player_game_facts;