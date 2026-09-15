import test from "node:test";
import assert from "node:assert/strict";
import {
  comparisonData,
  filterEligiblePredictionRows,
  gameSpecificSnapshot,
  hasVerifiedPredictionInputs,
  isEligiblePredictionSnapshot,
  isValidPredictionSnapshot,
  matchesPredictionPerformanceWindow,
  vectorForRows,
} from "./live-predictions";
import { safeNoVigProbabilities, validatePredictionOutputs } from "./prediction-validation";
import { standardize } from "./modeling";

test("rejects NaN and Infinity model outputs", () => {
  const failures = validatePredictionOutputs({
    projectedMargin: Number.NaN,
    projectedTotal: Number.POSITIVE_INFINITY,
    homeWinProbability: 0.5,
    awayWinProbability: 0.5,
  });
  assert.deepEqual(failures.map((failure) => failure.failedField), ["projectedMargin", "projectedTotal"]);
});

test("rejects invalid probabilities and probability sums", () => {
  const failures = validatePredictionOutputs({
    projectedMargin: 1,
    projectedTotal: 42,
    homeWinProbability: 1.2,
    awayWinProbability: -0.1,
  });
  assert.ok(failures.some((failure) => failure.failureReason.includes("between 0 and 1")));
  assert.ok(failures.some((failure) => failure.failedField === "probabilitySum"));
});

test("accepts normalized probabilities and finite football outputs", () => {
  assert.deepEqual(validatePredictionOutputs({
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
  }), []);
});

test("standardization converts non-finite feature values into safe finite inputs", () => {
  const result = standardize([[1, Number.NaN], [3, Number.POSITIVE_INFINITY]], [[Number.NEGATIVE_INFINITY, 2]]);
  assert.ok(result.train.flat().every(Number.isFinite));
  assert.ok(result.test.flat().every(Number.isFinite));
});

test("missing optional QB confidence does not invalidate complete model features", () => {
  const vector = vectorForRows([
    { gameId: "g", isHome: true, lowSample: false, features: { "season_to_date.offense.points": 24 } },
    { gameId: "g", isHome: false, lowSample: true, features: { "season_to_date.offense.points": 20 } },
  ], ["season_to_date.offense.points"]);
  assert.ok(vector);
  assert.deepEqual(vector?.x, [4, 0, 1, 0]);
  assert.equal(vector?.lowSample, true);
  assert.equal(vector?.inputFeatureCount, 1);
  assert.equal(vector?.inputMissingFeatureCount, 0);
});

test("missing model features are explicitly ineligible instead of becoming a silent default vector", () => {
  const vector = vectorForRows([
    { gameId: "g", isHome: true, lowSample: true, features: {} },
    { gameId: "g", isHome: false, lowSample: true, features: {} },
  ], ["season_to_date.offense.points", "last_3.defense.epa"]);
  assert.ok(vector);
  assert.equal(vector?.inputFeatureCount, 2);
  assert.equal(vector?.inputMissingFeatureCount, 2);
  assert.equal(hasVerifiedPredictionInputs(vector!), false);
});

test("different games cannot consume the same mismatched prediction record", () => {
  const gameOne = { id: 101, gameId: "game-1" };
  const gameTwo = { id: 202, gameId: "game-2" };
  const snapshots = new Map([
    ["game-1", gameOne],
    ["game-2", gameOne],
  ]);
  assert.equal(gameSpecificSnapshot("game-1", snapshots)?.id, 101);
  assert.equal(gameSpecificSnapshot("game-2", snapshots), undefined);
  snapshots.set("game-2", gameTwo);
  assert.equal(gameSpecificSnapshot("game-2", snapshots)?.id, 202);
});

test("missing sportsbook data leaves football projections but removes market edges", () => {
  const comparison = comparisonData({ markets: { spread: {}, total: {}, moneyline: {} } }, 4, 44, 0.6);
  assert.equal(comparison.spread.marketAvailable, false);
  assert.equal(comparison.spread.pointEdge, null);
  assert.equal(comparison.moneyline.homeProbabilityEdge, null);
  assert.equal(comparison.totals.pointEdge, null);
  assert.equal(safeNoVigProbabilities(0, 0), null);
});

test("DraftKings and FanDuel are independently optional per market", () => {
  const draftKingsOnly = comparisonData({
    markets: {
      spread: { bestAvailable: { point: -3 } },
      total: {},
      moneyline: {},
    },
  }, 4, 44, 0.6);
  assert.equal(draftKingsOnly.spread.marketAvailable, true);
  assert.equal(draftKingsOnly.totals.marketAvailable, false);
  assert.equal(draftKingsOnly.moneyline.marketAvailable, false);

  const fanDuelOnly = comparisonData({
    markets: {
      spread: {},
      total: { bestAvailable: { point: 44.5 } },
      moneyline: { noVigHomeProbability: 0.55, noVigAwayProbability: 0.45 },
    },
  }, 4, 44, 0.6);
  assert.equal(fanDuelOnly.spread.marketAvailable, false);
  assert.equal(fanDuelOnly.totals.marketAvailable, true);
  assert.equal(fanDuelOnly.moneyline.marketAvailable, true);
});

test("invalid legacy snapshots are excluded from official prediction views", () => {
  const valid = {
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    inputFeatureCount: 4,
    inputMissingFeatureCount: 0,
  };
  assert.equal(isValidPredictionSnapshot(valid), true);
  assert.equal(isEligiblePredictionSnapshot(valid), true);
  assert.equal(isEligiblePredictionSnapshot({ ...valid, inputFeatureCount: 0 }), false);
  assert.equal(isEligiblePredictionSnapshot({ ...valid, inputMissingFeatureCount: 1 }), false);
  assert.equal(isValidPredictionSnapshot({ ...valid, projectedMargin: Number.NaN }), false);
  assert.equal(isValidPredictionSnapshot({ ...valid, homeWinProbability: 1.1, awayWinProbability: -0.1 }), false);
  assert.equal(isValidPredictionSnapshot({ ...valid, projectedTotal: null }), false);
});

test("weekly report inputs exclude numerically valid snapshots without verified provenance", () => {
  const base = {
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    inputFeatureCount: 4,
    inputMissingFeatureCount: 0,
  };
  const rows = filterEligiblePredictionRows([
    { label: "verified", prediction: base },
    { label: "legacy", prediction: { ...base, inputFeatureCount: 0 } },
  ]);
  assert.deepEqual(rows.map((row) => row.label), ["verified"]);
});

test("weekly performance includes only games in the requested season and week", () => {
  const requested = { season: 2026, week: 2 };
  assert.equal(matchesPredictionPerformanceWindow({ game: { season: 2026, week: 2 } }, requested), true);
  assert.equal(matchesPredictionPerformanceWindow({ game: { season: 2026, week: 1 } }, requested), false);
  assert.equal(matchesPredictionPerformanceWindow({ game: { season: 2025, week: 2 } }, requested), false);
  assert.equal(matchesPredictionPerformanceWindow({ game: null }, requested), false);
  assert.equal(matchesPredictionPerformanceWindow({ game: null }), true);
});
