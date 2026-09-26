import test from "node:test";
import assert from "node:assert/strict";
import { assertExactWeek2SourceGames, datasetUrl } from "./nflverse";

const expected = Array.from({ length: 16 }, (_, index) => `canonical-${index + 1}`);
const observed = new Map(expected.map((gameId, index) => [`source-${index + 1}`, gameId]));

test("recovery uses the public 2026 PBP release, not a paid data provider", () => {
  assert.equal(datasetUrl("pbp", 2026),
    "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz");
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