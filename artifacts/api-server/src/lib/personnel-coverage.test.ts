import test from "node:test";
import assert from "node:assert/strict";
import { coveragePercent, latestCoverageAnchor } from "./coverage-math";

test("coverage percentages use real denominator and unavailable is zero", () => {
  assert.equal(coveragePercent(3, 4), 75);
  assert.equal(coveragePercent(0, 0), 0);
  assert.equal(coveragePercent(1, 0), 0);
});

test("coverage anchor uses upcoming week, then latest past week", () => {
  const now = new Date("2025-10-10T00:00:00.000Z");
  const games = [
    { season: 2025, week: 4, kickoffTime: new Date("2025-09-28T00:00:00.000Z") },
    { season: 2025, week: 5, kickoffTime: new Date("2025-10-12T00:00:00.000Z") },
    { season: 2025, week: 3, kickoffTime: new Date("2025-09-21T00:00:00.000Z") },
  ];
  assert.equal(latestCoverageAnchor(games, now)?.week, 5);
  assert.equal(latestCoverageAnchor(games.slice(0, 1), now)?.week, 4);
});