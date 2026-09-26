import test from "node:test";
import assert from "node:assert/strict";
import { assertExactWeek2SourceGames, datasetUrl, deriveAndPersistRedZoneOpportunities } from "./nflverse";
import { isRedZoneFeatureEnabled } from "./red-zone-feature-flag";

const expected = Array.from({ length: 16 }, (_, index) => `canonical-${index + 1}`);
const observed = new Map(expected.map((gameId, index) => [`source-${index + 1}`, gameId]));

test("recovery uses the public 2026 PBP release, not a paid data provider", () => {
  assert.equal(datasetUrl("pbp", 2026),
    "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz");
});

test("red-zone opt-in requires the exact enabled value", () => {
  assert.equal(isRedZoneFeatureEnabled({ GRIDLINE_RED_ZONE_ENABLED: "1" }), true);
  for (const value of [undefined, "", "true", "yes", "01"]) {
    assert.equal(isRedZoneFeatureEnabled({ GRIDLINE_RED_ZONE_ENABLED: value }), false);
  }
});

test("disabled PBP refresh skips red-zone derivation before reading source or touching the database", async () => {
  const previous = process.env.GRIDLINE_RED_ZONE_ENABLED;
  delete process.env.GRIDLINE_RED_ZONE_ENABLED;
  try {
    const result = await deriveAndPersistRedZoneOpportunities(2026, "/no/such/pbp-file.csv");
    assert.deepEqual(result, {
      sourceRows: 0,
      games: 0,
      sourceGameIds: [],
      playerFacts: 0,
      teamFacts: 0,
      deduplicatedPlays: 0,
      skipped: true,
    });
  } finally {
    if (previous === undefined) delete process.env.GRIDLINE_RED_ZONE_ENABLED;
    else process.env.GRIDLINE_RED_ZONE_ENABLED = previous;
  }
});

test("exact Week 2 source identities cover all 16 distinct canonical games", () => {
  assert.doesNotThrow(() => assertExactWeek2SourceGames(expected, observed));
  assert.throws(() => assertExactWeek2SourceGames(expected, new Map([...observed].slice(1))), /16 distinct/);
  assert.throws(() => assertExactWeek2SourceGames(expected, new Map([
    ...observed, ["extra-source", "unknown-game"],
  ])), /16 distinct/);
  assert.throws(() => assertExactWeek2SourceGames(expected, new Map([
    ...[...observed].slice(0, 15), ["duplicate-source", expected[0]!],
  ])), /16 distinct/);
  assert.throws(() => assertExactWeek2SourceGames(expected, new Map([
    ...[...observed].slice(0, 15), ["wrong-source", "unknown-game"],
  ])), /16 distinct/);
  assert.throws(() => assertExactWeek2SourceGames([...expected.slice(0, 15), expected[0]!], observed), /16 distinct/);
});