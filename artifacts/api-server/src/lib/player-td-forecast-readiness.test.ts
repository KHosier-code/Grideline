import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerTdForecastReadiness } from "./player-td-forecast-readiness";

test("unverified roster and source evidence withholds every upcoming scoring TD probability", () => {
  const result = buildPlayerTdForecastReadiness({
    asOf: new Date("2026-09-26T16:00:00Z"),
    upcomingGames: 1,
    candidates: [
      { playerId: "traded-player", playerName: "Traded Player", gameId: "game-a" },
      { playerId: "out-player", playerName: "Out Player", gameId: "game-a" },
    ],
    modelVersion: "research-only",
    blockers: ["Current player/team assignment and injury status are not verified"],
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.forecasts, []);
  assert.equal(result.withheld.length, 2);
  assert.ok(result.withheld.every((row) => row.reason.includes("not verified")));
  assert.equal(result.asOf, "2026-09-26T16:00:00.000Z");
});

test("empty slate never manufactures a forecast or alternate historical simulation", () => {
  const result = buildPlayerTdForecastReadiness({
    asOf: null, upcomingGames: 0, candidates: [], blockers: ["No future games"], modelVersion: null,
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.forecasts, []);
  assert.deepEqual(result.withheld, []);
});