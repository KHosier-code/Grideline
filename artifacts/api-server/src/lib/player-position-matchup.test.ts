import test from "node:test";
import assert from "node:assert/strict";
import { attachQualifiedScoringTdProbability, buildPlayerPositionMatchup } from "./player-position-matchup";
import type { DefenseInputs } from "./defense-vs-position";

const now = new Date("2026-09-20T12:00:00Z");
function sample(): { input: DefenseInputs; upcoming: DefenseInputs["games"][number] } {
  const games = [1, 2, 3, 4].map(week => ({
    gameId: `g${week}`, season: 2026, week, kickoffTime: new Date(`2026-09-${String(week + 1).padStart(2, "0")}T18:00:00Z`),
    gameStatus: "STATUS_FINAL", homeTeamId: "cin", awayTeamId: "pit",
  }));
  const upcoming = { gameId: "next", season: 2026, week: 5, kickoffTime: new Date("2026-09-21T18:00:00Z"),
    gameStatus: "STATUS_SCHEDULED", homeTeamId: "pit", awayTeamId: "cin" };
  const stat = (week: number, playerId: string, teamId: string, opponentTeamId: string,
    position: string, targets: number | null, receivingYards: number | null) => ({
    id: week, playerId, playerName: playerId, teamId, opponentTeamId, position,
    season: 2026, week, seasonType: "REG", targets, receivingYards, receptions: 0,
    receivingTds: 0, carries: 0, rushingYards: 0, rushingTds: 0,
    attempts: 0, passingYards: 0, passingTds: 0, interceptions: 0,
    sourceUpdatedAt: new Date("2026-09-10T00:00:00Z"),
  });
  const stats = [1, 2, 3, 4].flatMap(week => [
    stat(week, "te-a", "CIN", "PIT", "TE", week === 2 ? 0 : week, week === 2 ? 0 : 10 * week),
    stat(week, "te-b", "CIN", "PIT", "TE", 1, 5),
    stat(week, "te-pit", "PIT", "CIN", "TE", 2, 8),
    stat(week, "qb-cin", "CIN", "PIT", "QB", 0, 0),
    stat(week, "qb-pit", "PIT", "CIN", "QB", 0, 0),
  ]);
  const rzTeams = [1, 2, 3, 4].flatMap(week => ["CIN", "PIT"].map(teamId => ({
    gameId: `g${week}`, season: 2026, week, seasonType: "REG", teamId,
    opponentTeamId: teamId === "CIN" ? "PIT" : "CIN", zone: 20,
    ingestedAt: new Date("2026-09-10T00:00:00Z"),
  })));
  return { upcoming, input: {
    games: [...games, upcoming], stats, rzTeams, rzPlayers: [],
    teams: [{ teamId: "cin", abbreviation: "CIN" }, { teamId: "pit", abbreviation: "PIT" }],
    sources: ["player_stats", "pbp"].map(dataset => ({ dataset, season: 2026, status: "success" })),
  } as unknown as DefenseInputs };
}
const selected = (input: DefenseInputs, upcoming: DefenseInputs["games"][number], window: "season" | "last3" = "season") =>
  buildPlayerPositionMatchup(input, upcoming, now, "TE", window, "te-a:CIN")!;

test("TE individual yards never equal the position allowance; zero is observed, missing is not", () => {
  const { input, upcoming } = sample();
  const data = selected(input, upcoming);
  assert.ok(data.selected, JSON.stringify(data.candidates));
  assert.equal(data.metrics.receivingYards.player.total, 80); // 10 + 0 + 30 + 40
  assert.equal(data.metrics.receivingYards.player.perGame, 20);
  assert.equal(data.metrics.receivingYards.defense?.total, 100); // + 5 per game from other TE
  assert.equal(data.metrics.receivingYards.defense?.perGame, 25);
  assert.equal(data.score.value !== null, true);
  assert.equal(data.projections.receivingYards.value, null);
  input.stats.find(r => r.playerId === "te-a" && r.week === 2)!.receivingYards = null;
  const missing = selected(input, upcoming);
  assert.equal(missing.metrics.receivingYards.player.coveredGames, 3);
  assert.deepEqual(missing.metrics.receivingYards.player.missingWeeks, [2]);
  assert.equal(missing.metrics.receivingYards.defense?.coveredGames, 3);
});

test("cutoff, partial defense coverage, trades and schedule identities fail closed", () => {
  const { input, upcoming } = sample();
  input.rzTeams = input.rzTeams.filter(r => r.week === 1);
  assert.equal(selected(input, upcoming).score.value, null);
  assert.equal(selected(input, upcoming).metrics.receivingYards.defense?.coveredGames, 1);
  const traded = input.stats.find(r => r.playerId === "te-a" && r.week === 4)!;
  traded.teamId = "PIT"; traded.opponentTeamId = "CIN";
  assert.equal(selected(input, upcoming).metrics.receivingYards.player.total, 40);
  assert.equal(buildPlayerPositionMatchup(input, upcoming, new Date("2026-09-22T00:00:00Z"), "TE", "season"), null);
  assert.equal(buildPlayerPositionMatchup(input, { ...upcoming, gameStatus: "STATUS_HALFTIME" }, now, "TE", "season"), null);
  input.stats.find(r => r.playerId === "te-a" && r.week === 3)!.sourceUpdatedAt = upcoming.kickoffTime!;
  assert.deepEqual(selected(input, upcoming).metrics.receivingYards.player.coveredWeeks, [1, 2]);
});

test("TD probability attaches only from separately qualified exact-game and team evidence", () => {
  const { input, upcoming } = sample();
  const data = selected(input, upcoming);
  const forecast = { gameId: "next", playerId: "te-a", teamId: "CIN", opponentTeamId: "PIT",
    probability: 0.3, modelVersion: "td-frozen", cutoffAt: now.toISOString() };
  attachQualifiedScoringTdProbability(data, { status: "unavailable", forecasts: [forecast], blockers: ["not approved"] });
  assert.equal(data.projections.scoringTdProbability.value, null);
  attachQualifiedScoringTdProbability(data, { status: "forecasts", forecasts: [{ ...forecast, opponentTeamId: "CIN" }] });
  assert.equal(data.projections.scoringTdProbability.value, null);
  attachQualifiedScoringTdProbability(data, { status: "forecasts", forecasts: [forecast] });
  assert.equal(data.projections.scoringTdProbability.value, 0.3);
  assert.equal(data.projections.scoringTdProbability.kind, "probability");
});