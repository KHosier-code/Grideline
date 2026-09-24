import test from "node:test";
import assert from "node:assert/strict";
import {
  authoritativeFinalRegularSeasonGame,
  buildTeamRecords,
  consumerFinalScore,
  interpretNflGameState,
  verifyTeamRecords,
} from "./game-state";

const now = new Date("2026-09-15T12:00:00Z");

test("normalizes provider statuses and never treats scheduled 0-0 as a result", () => {
  const scheduled = {
    gameStatus: "STATUS_SCHEDULED",
    kickoffTime: new Date("2026-09-17T23:00:00Z"),
    finalHomeScore: 0,
    finalAwayScore: 0,
  };
  assert.equal(interpretNflGameState(scheduled, now), "pregame");
  assert.equal(interpretNflGameState(scheduled, scheduled.kickoffTime), "live");
  assert.equal(interpretNflGameState({ ...scheduled, gameStatus: "STATUS_FINAL" }, now), "final");
  assert.equal(consumerFinalScore(scheduled, now), null);
  assert.equal(interpretNflGameState({ ...scheduled, gameStatus: "STATUS_IN_PROGRESS" }, now), "live");
  assert.equal(interpretNflGameState({ ...scheduled, gameStatus: "STATUS_POSTPONED" }, now), "postponed");
  assert.equal(interpretNflGameState({ ...scheduled, gameStatus: "STATUS_CANCELED" }, now), "cancelled");
});

test("authoritative records require final regular-season status and valid integer scores", () => {
  const base = {
    week: 2,
    gameStatus: "STATUS_FINAL",
    kickoffTime: new Date("2026-09-13T17:00:00Z"),
    finalHomeScore: 24,
    finalAwayScore: 17,
  };
  assert.equal(authoritativeFinalRegularSeasonGame(base, now), true);
  assert.equal(authoritativeFinalRegularSeasonGame({ ...base, week: 19 }, now), false);
  assert.equal(authoritativeFinalRegularSeasonGame({ ...base, gameStatus: "STATUS_SCHEDULED", finalHomeScore: 0, finalAwayScore: 0 }, now), false);
  assert.equal(authoritativeFinalRegularSeasonGame({ ...base, finalHomeScore: null }, now), false);
});

test("builds records from final regular-season games and verifies the team set", () => {
  const teams = [
    { teamId: "DET", abbreviation: "DET", teamName: "Detroit Lions" },
    { teamId: "BUF", abbreviation: "BUF", teamName: "Buffalo Bills" },
  ];
  const records = buildTeamRecords(teams, [{
    homeTeamId: "BUF",
    awayTeamId: "DET",
    week: 1,
    gameStatus: "STATUS_FINAL",
    kickoffTime: new Date("2026-09-07T17:00:00Z"),
    finalHomeScore: 21,
    finalAwayScore: 24,
  }, {
    homeTeamId: "DET",
    awayTeamId: "BUF",
    week: 2,
    gameStatus: "STATUS_SCHEDULED",
    kickoffTime: new Date("2026-09-17T23:00:00Z"),
    finalHomeScore: 0,
    finalAwayScore: 0,
  }], now);
  assert.deepEqual(records.map(({ abbreviation, wins, losses }) => ({ abbreviation, wins, losses })), [
    { abbreviation: "BUF", wins: 0, losses: 1 },
    { abbreviation: "DET", wins: 1, losses: 0 },
  ]);
  assert.deepEqual(verifyTeamRecords(records, { expectedTeamCount: 2 }), {
    expectedTeamCount: 2,
    actualTeamCount: 2,
    targetWeek: null,
    completedPriorGames: 1,
    complete: true,
    discrepancies: [],
  });
});

test("record verification fails closed for all-zero records and incomplete Week 2 evidence", () => {
  const records = Array.from({ length: 32 }, (_, index) => ({
    teamId: String(index),
    abbreviation: `T${index}`,
    teamName: `Team ${index}`,
    wins: 0, losses: 0, ties: 0, games: 0,
  }));
  const verification = verifyTeamRecords(records, { targetWeek: 2, completedPriorGames: 0 });
  assert.equal(verification.complete, false);
  assert.ok(verification.discrepancies.some((item) => item.includes("16 authoritative")));
  assert.ok(verification.discrepancies.some((item) => item.includes("exactly 1")));
});

test("record verification accepts exactly one authoritative Week 1 game per team", () => {
  const records = Array.from({ length: 32 }, (_, index) => ({
    teamId: String(index),
    abbreviation: `T${index}`,
    teamName: `Team ${index}`,
    wins: index % 2 ? 0 : 1, losses: index % 2 ? 1 : 0, ties: 0, games: 1,
  }));
  const verification = verifyTeamRecords(records, { targetWeek: 2, completedPriorGames: 16 });
  assert.equal(verification.complete, true);
});