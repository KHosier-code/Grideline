import test from "node:test";
import assert from "node:assert/strict";
import {
  comparisonData,
  evaluateProductionInputEligibility,
  filterEligiblePredictionRows,
  gameSpecificSnapshot,
  hasVerifiedPredictionInputs,
  immutableAuditVector,
  isEligiblePredictionSnapshot,
  isValidPredictionSnapshot,
  matchesPredictionPerformanceWindow,
  sharedProductionFeatureVersion,
  snapshotMatchesProductionModels,
  vectorForRows,
} from "./live-predictions";
import { safeNoVigProbabilities, validatePredictionOutputs } from "./prediction-validation";
import { standardize, trainingVectorForRows } from "./modeling";
import { PHASE6_VECTOR_FEATURE_NAMES, PHASE6_VECTOR_SCHEMA_FINGERPRINT } from "./modeling";
import { pregameSourceCutoff } from "./features";

function completeSnapshot(overrides: Record<string, unknown> = {}) {
  const selectedHome = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name) => [name, 1]));
  const selectedAway = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name) => [name, 0]));
  return {
    gameId: "game",
    predictionTimestamp: new Date("2026-09-15T12:00:00Z"),
    kickoffTime: new Date("2026-09-20T17:00:00Z"),
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    inputFeatureCount: 27,
    inputMissingFeatureCount: 0,
    spreadModelVersion: "spread-v1",
    moneylineModelVersion: "moneyline-v1",
    totalsModelVersion: "totals-v1",
    inputVector: [...Array(24).fill(1), 0, 1, 0.5],
    vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
    vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
    inputSourceEvidence: {
      rows: [
        {
          gameId: "game", teamId: "home", opponentTeamId: "away", isHome: true,
          sourceCutoff: "2026-09-15T11:00:00Z", generatedAt: "2026-09-15T11:30:00Z",
          lowSample: false, qbDataConfidence: 1, selectedValues: selectedHome,
        },
        {
          gameId: "game", teamId: "away", opponentTeamId: "home", isHome: false,
          sourceCutoff: "2026-09-15T11:00:00Z", generatedAt: "2026-09-15T11:30:00Z",
          lowSample: true, qbDataConfidence: 0.5, selectedValues: selectedAway,
        },
      ],
    },
    snapshotKey: `game:label:spread-v1:moneyline-v1:totals-v1:input-integrity-v3:${PHASE6_VECTOR_SCHEMA_FINGERPRINT}`,
    ...overrides,
  };
}

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

test("training vectors reject missing selected features and QB confidence instead of zero-imputing", () => {
  const complete = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name, index) => [name, index + 1]));
  const home = { lowSample: false, features: { ...complete, qb_data_confidence: 1 } };
  const away = { lowSample: true, features: { ...complete, qb_data_confidence: 0.5 } };
  assert.ok(trainingVectorForRows(home, away));
  assert.equal(trainingVectorForRows({ ...home, features: { ...home.features, [PHASE6_VECTOR_FEATURE_NAMES[0]]: null } }, away), null);
  assert.equal(trainingVectorForRows(home, { ...away, features: { ...complete } }), null);
});

test("missing QB confidence remains unavailable and invalidates production input", () => {
  const vector = vectorForRows([
    { gameId: "g", isHome: true, lowSample: false, features: { "season_to_date.offense.points": 24 } },
    { gameId: "g", isHome: false, lowSample: true, features: { "season_to_date.offense.points": 20 } },
  ], ["season_to_date.offense.points"]);
  assert.ok(vector);
  assert.equal(vector?.x, null);
  assert.deepEqual(vector?.values, [4, 0, 1, null]);
  assert.equal(vector?.lowSample, true);
  assert.equal(vector?.inputFeatureCount, 4);
  assert.equal(vector?.inputMissingFeatureCount, 1);
  assert.match(vector?.qb.home.unavailableReason ?? "", /unavailable/i);
});

test("missing model features are explicitly ineligible instead of becoming a silent default vector", () => {
  const vector = vectorForRows([
    { gameId: "g", isHome: true, lowSample: true, features: {} },
    { gameId: "g", isHome: false, lowSample: true, features: {} },
  ], ["season_to_date.offense.points", "last_3.defense.epa"]);
  assert.ok(vector);
  assert.equal(vector?.inputFeatureCount, 5);
  assert.equal(vector?.inputMissingFeatureCount, 3);
  assert.equal(hasVerifiedPredictionInputs(vector!), false);
});

test("legitimate zeroes stay distinct from unavailable values and games keep distinct vectors", () => {
  const first = vectorForRows([
    { gameId: "one", isHome: true, lowSample: false, features: { selected: 0, qb_data_confidence: 1 } },
    { gameId: "one", isHome: false, lowSample: false, features: { selected: 2, qb_data_confidence: 0.5 } },
  ], ["selected"]);
  const second = vectorForRows([
    { gameId: "two", isHome: true, lowSample: false, features: { selected: 3, qb_data_confidence: 1 } },
    { gameId: "two", isHome: false, lowSample: false, features: { selected: 2, qb_data_confidence: 0.5 } },
  ], ["selected"]);
  assert.deepEqual(first?.x, [-2, 0, 0, 0.5]);
  assert.equal(first?.legitimateZeroCount, 2);
  assert.equal(first?.formerlyMissingZeroCount, 0);
  assert.notDeepEqual(first?.x, second?.x);
});

test("row identity and strict cutoff evidence are required before production execution", () => {
  const kickoffTime = new Date("2026-09-20T17:00:00Z");
  const now = new Date("2026-09-15T12:00:00Z");
  const completeFeatures = Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => [`f${index}`, index + 1]),
  );
  const names = Object.keys(completeFeatures);
  const rows = [
    { gameId: "g", teamId: "home", opponentTeamId: "away", isHome: true, lowSample: false, features: { ...completeFeatures, qb_data_confidence: 1 }, sourceCutoff: now, generatedAt: now },
    { gameId: "g", teamId: "away", opponentTeamId: "home", isHome: false, lowSample: false, features: { ...completeFeatures, qb_data_confidence: 0.5 }, sourceCutoff: now, generatedAt: now },
  ];
  const vector = vectorForRows(rows, names);
  const game = { gameId: "g", homeTeamId: "home", awayTeamId: "away", kickoffTime } as any;
  assert.equal(evaluateProductionInputEligibility(game, rows, vector, true, now).eligible, true);
  const atKickoff = rows.map((row) => ({ ...row, sourceCutoff: kickoffTime }));
  assert.equal(evaluateProductionInputEligibility(game, atKickoff, vectorForRows(atKickoff, names), true, now).eligible, false);
  const futureWindowBoundary = rows.map((row) => ({ ...row, sourceCutoff: new Date(kickoffTime.getTime() - 1) }));
  assert.equal(evaluateProductionInputEligibility(game, futureWindowBoundary, vectorForRows(futureWindowBoundary, names), true, now).eligible, false);
  const rebuiltCutoff = pregameSourceCutoff(kickoffTime, now);
  assert.equal(rebuiltCutoff.toISOString(), now.toISOString());
  const rebuiltRows = rows.map((row) => ({ ...row, sourceCutoff: rebuiltCutoff, generatedAt: now }));
  assert.equal(evaluateProductionInputEligibility(game, rebuiltRows, vectorForRows(rebuiltRows, names), true, now).eligible, true);
  const mismatched = [{ ...rows[0], opponentTeamId: "other" }, rows[1]];
  assert.equal(evaluateProductionInputEligibility(game, mismatched, vectorForRows(mismatched, names), true, now).eligible, false);
});

test("mixed active model feature versions fail the shared production schema gate", () => {
  assert.equal(sharedProductionFeatureVersion([
    { featureVersion: "pregame-v3" },
    { featureVersion: "pregame-v3" },
    { featureVersion: "pregame-v3" },
  ]), "pregame-v3");
  assert.equal(sharedProductionFeatureVersion([
    { featureVersion: "pregame-v3" },
    { featureVersion: "pregame-v3" },
    { featureVersion: "pregame-v4-personnel-context" },
  ]), null);
  assert.equal(sharedProductionFeatureVersion([{ featureVersion: "pregame-v3" }]), null);
});

test("consumer snapshot provenance must match every active model and exact vector width", () => {
  const artifact = {
    version: 1,
    algorithm: "linear_regression",
    centers: Array(27).fill(0),
    scales: Array(27).fill(1),
    model: { kind: "linear", coefficients: Array(28).fill(0) },
  };
  const models = new Map([
    ["spread", { family: "spread", algorithm: "linear_regression", featureVersion: "pregame-v3", modelVersion: "spread-v1", vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES], vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT, modelArtifact: artifact }],
    ["moneyline", { family: "moneyline", algorithm: "linear_regression", featureVersion: "pregame-v3", modelVersion: "moneyline-v1", vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES], vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT, modelArtifact: artifact }],
    ["totals", { family: "totals", algorithm: "linear_regression", featureVersion: "pregame-v3", modelVersion: "totals-v1", vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES], vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT, modelArtifact: artifact }],
  ]) as any;
  const snapshot = completeSnapshot({
    featureVersion: "pregame-v3",
  }) as any;
  assert.equal(snapshotMatchesProductionModels(snapshot, models), true);
  assert.equal(snapshotMatchesProductionModels({ ...snapshot, inputFeatureCount: 26 }, models), false);
  assert.equal(snapshotMatchesProductionModels({ ...snapshot, totalsModelVersion: "old-totals" }, models), false);
  assert.equal(snapshotMatchesProductionModels({ ...snapshot, snapshotKey: "legacy" }, models), false);
  assert.equal(snapshotMatchesProductionModels({
    ...snapshot,
    vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES.slice(1), PHASE6_VECTOR_FEATURE_NAMES[0]],
  }, models), false);
});

test("snapshot audit vectors remain immutable when current future rows change", () => {
  const snapshot = { inputVector: [1, 2, 3] };
  const currentVector = [9, 8, 7];
  assert.deepEqual(immutableAuditVector(snapshot, currentVector), [1, 2, 3]);
  currentVector[0] = 0;
  assert.deepEqual(immutableAuditVector(snapshot, currentVector), [1, 2, 3]);
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
  const numericOnly = {
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    inputFeatureCount: 27,
    inputMissingFeatureCount: 0,
  };
  const valid = completeSnapshot();
  assert.equal(isValidPredictionSnapshot(numericOnly), true);
  assert.equal(isEligiblePredictionSnapshot(numericOnly as any), false);
  assert.equal(isEligiblePredictionSnapshot(valid), true);
  assert.equal(isEligiblePredictionSnapshot({ ...valid, inputFeatureCount: 0 }), false);
  assert.equal(isEligiblePredictionSnapshot({ ...valid, inputMissingFeatureCount: 1 }), false);
  assert.equal(isEligiblePredictionSnapshot({
    ...valid,
    inputSourceEvidence: { rows: (valid.inputSourceEvidence.rows as Array<Record<string, unknown>>).map((row) => ({ ...row, gameId: "other" })) },
  }), false);
  assert.equal(isEligiblePredictionSnapshot({
    ...valid,
    inputSourceEvidence: { rows: (valid.inputSourceEvidence.rows as Array<Record<string, unknown>>).map((row) => ({ ...row, sourceCutoff: "2026-09-21T00:00:00Z" })) },
  }), false);
  assert.equal(isEligiblePredictionSnapshot({ ...valid, inputVector: [...valid.inputVector.slice(0, -1), 0] }), false);
  assert.equal(isValidPredictionSnapshot({ ...valid, projectedMargin: Number.NaN }), false);
  assert.equal(isValidPredictionSnapshot({ ...valid, homeWinProbability: 1.1, awayWinProbability: -0.1 }), false);
  assert.equal(isValidPredictionSnapshot({ ...valid, projectedTotal: null }), false);
});

test("weekly report inputs exclude numerically valid snapshots without verified provenance", () => {
  const base = completeSnapshot();
  const rows = filterEligiblePredictionRows([
    { label: "verified", prediction: base },
    { label: "legacy", prediction: { ...base, inputVector: null } },
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
