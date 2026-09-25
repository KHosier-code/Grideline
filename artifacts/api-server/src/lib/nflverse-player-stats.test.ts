import assert from "node:assert/strict";
import test from "node:test";
import { datasetUrl, parsePlayerStatsRow } from "./nflverse";

test("new weekly player release is season-specific while older archives retain their URLs", () => {
  assert.match(datasetUrl("player_stats", 2026), /\/stats_player\/stats_player_week_2026\.csv\.gz$/);
  assert.match(datasetUrl("player_stats", 2025), /\/stats_player\/stats_player_week_2025\.csv\.gz$/);
  assert.match(datasetUrl("player_stats", 2024), /\/player_stats\/player_stats_2024\.csv\.gz$/);
});

test("current weekly player rows retain GSIS, team/opponent, and passing values", () => {
  const row = {
    player_id: "00-0033873", player_display_name: "Patrick Mahomes", position: "QB",
    season: "2026", week: "2", season_type: "REG", team: "KC", opponent_team: "LAC",
    attempts: "37", passing_interceptions: "1", sacks_suffered: "2", passing_yards: "251",
  };
  assert.deepEqual(
    (({ playerId, teamId, opponentTeamId, season, week, interceptions, sacks, passingYards }) =>
      ({ playerId, teamId, opponentTeamId, season, week, interceptions, sacks, passingYards }))(
      parsePlayerStatsRow(row, 2026)!,
    ),
    { playerId: "00-0033873", teamId: "KC", opponentTeamId: "LAC",
      season: 2026, week: 2, interceptions: 1, sacks: 2, passingYards: 251 },
  );
  assert.equal(parsePlayerStatsRow(row, 2025), null);
  assert.equal(parsePlayerStatsRow({ ...row, season_type: "PRE" }, 2026), null);
  const { opponent_team: _missing, ...withoutOpponent } = row;
  assert.throws(() => parsePlayerStatsRow(withoutOpponent, 2026),
    /missing required/);
});