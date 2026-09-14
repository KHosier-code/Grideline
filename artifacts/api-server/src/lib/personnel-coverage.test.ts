import test from "node:test";
import assert from "node:assert/strict";
import { coveragePercent, isWeatherEligible, latestCoverageAnchor, passesReadinessThreshold } from "./coverage-math";

test("coverage percentages use real denominator and unavailable is zero", () => {
  assert.equal(coveragePercent(3, 4), 75);
  assert.equal(coveragePercent(0, 0), 0);
  assert.equal(coveragePercent(1, 0), 0);
  assert.equal(coveragePercent(40, 28), 100);
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

test("weather eligibility excludes indoor games but includes retractable roofs", () => {
  assert.equal(isWeatherEligible("outdoor", "not_applicable"), true);
  assert.equal(isWeatherEligible("indoor", "retractable"), true);
  assert.equal(isWeatherEligible("indoor", "not_applicable"), false);
  assert.equal(isWeatherEligible(null, null), false);
});

test("readiness threshold math is inclusive and null-safe", () => {
  assert.equal(passesReadinessThreshold(80, 80), true);
  assert.equal(passesReadinessThreshold(79.99, 80), false);
  assert.equal(passesReadinessThreshold(null, 80), false);
});