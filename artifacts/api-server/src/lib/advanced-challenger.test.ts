import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCED_POLICY, applyReferenceAvailability, assertAdvancedIsolation, canonicalAdvancedJson, evaluateAdvancedChallenger, evaluateLeaveFamilyOut, fitElasticNet,
  selectLockedBaselinePredictions,
  renderAdvancedChallengerMarkdown,
} from "./advanced-challenger";
import type { AdvancedRow } from "./advanced-challenger";

function row(index: number, season = 2025): AdvancedRow {
  const kickoffTime = new Date(Date.UTC(season, 0, index + 1, 17));
  return {
    gameId: `${season}-${index}`, season, week: index + 1, kickoffTime, x: [index % 5, (index % 7) / 7],
    featureNames: ["team_form.a", "team_form.b"], featureFamilies: ["team_form"],
    lowSample: false, qbConfidence: 1, homeTeamId: "H", awayTeamId: "A",
    homeTeamAbbreviation: "H", awayTeamAbbreviation: "A", homeFeatureSourceCutoff: new Date(kickoffTime.getTime() - 2),
    awayFeatureSourceCutoff: new Date(kickoffTime.getTime() - 2), actualHomeScore: 20 + index,
    actualAwayScore: 17, gameStage: "regular", margin: 3 + index % 4, total: 37 + index % 5, homeWin: index % 2,
    featureCutoff: new Date(kickoffTime.getTime() - 3),
  };
}

test("advanced policy excludes forward seasons and enforces cutoff chronology", () => {
  assert.equal(ADVANCED_POLICY.testSeason, 2025);
  assert.throws(() => assertAdvancedIsolation({ concept: "independent_football", rows: [{ ...row(1), season: 2026 }] }), /Forward-season/);
  assert.throws(() => assertAdvancedIsolation({ concept: "independent_football", rows: [{ ...row(1), featureCutoff: row(1).kickoffTime }] }), /strictly before/);
  assert.throws(() => assertAdvancedIsolation({ concept: "independent_football", rows: [{ ...row(1), featureNames: ["market.spread"] }] }), /cannot contain market/);
});

test("elastic net is deterministic and finite", () => {
  const first = fitElasticNet([[0, 1], [1, 0], [2, 1]], [1, 2, 3]);
  const second = fitElasticNet([[0, 1], [1, 0], [2, 1]], [1, 2, 3]);
  assert.deepEqual(first.coefficients, second.coefficients);
  assert.ok(Number.isFinite(first.predict([1, 1])));
});

test("independent challenger produces a guarded, non-promotable result", () => {
  const rows = [...Array.from({ length: 20 }, (_, i) => row(i, 2024)), ...Array.from({ length: 35 }, (_, i) => row(i, 2025))];
  const result = evaluateAdvancedChallenger({ concept: "independent_football", family: "spread", algorithm: "elastic_net", rows, featureNames: ["team_form.a", "team_form.b"], baselinePredictions: Object.fromEntries(rows.filter((item) => item.season === 2025).map((item) => [item.gameId, 0])) });
  assert.equal(result.promotionEligible, false);
  assert.equal(result.productionMutation, false);
  assert.ok(result.verdict);
  assert.match(result.verdict, /MATERIAL IMPROVEMENT|NO MATERIAL IMPROVEMENT|WORSE THAN BASELINE/);
  assert.equal(result.trainingSeasons.join(","), "2021,2022,2023,2024");
});

test("markdown is deterministic and discloses recorded-market limitations", () => {
  const report = { models: [{ concept: "market_residual", family: "spread", algorithm: "elastic_net", sampleSize: 0, verdict: "NO MATERIAL IMPROVEMENT" }] };
  const markdown = renderAdvancedChallengerMarkdown(report);
  assert.equal(markdown, renderAdvancedChallengerMarkdown(report));
  assert.match(markdown, /not verified closing/);
  assert.match(markdown, /NO MATERIAL IMPROVEMENT/);
});

test("canonical evidence identity is independent of object insertion order", () => {
  assert.equal(canonicalAdvancedJson({ z: 1, a: { d: 2, c: 3 } }), canonicalAdvancedJson({ a: { c: 3, d: 2 }, z: 1 }));
});

test("leave-family-out ablations refit measured families and disclose unavailable families", () => {
  const rows = [...Array.from({ length: 20 }, (_, i) => row(i, 2024)), ...Array.from({ length: 35 }, (_, i) => row(i, 2025))];
  const report = evaluateLeaveFamilyOut({ family: "spread", rows, featureNames: ["team_form.a", "team_form.b"], algorithm: "elastic_net" });
  const team = report.find((item) => item.family === "team_form");
  assert.equal(team?.status, "measured");
  assert.equal(typeof team?.pairedMetricDelta, "number");
  assert.equal(report.find((item) => item.family === "personnel")?.status, "unavailable");
});

test("market residual fitting rejects missing historical training quotes", () => {
  const rows = [...Array.from({ length: 20 }, (_, i) => row(i, 2024)), ...Array.from({ length: 35 }, (_, i) => row(i, 2025))];
  assert.throws(() => evaluateAdvancedChallenger({
    concept: "market_residual", family: "spread", algorithm: "elastic_net", rows,
    featureNames: ["team_form.a", "team_form.b"],
  }), /recorded training quotes/);
});

test("baseline pairing uses exact intersection and never imputes missing predictions", () => {
  const rows = [...Array.from({ length: 20 }, (_, i) => row(i, 2024)), ...Array.from({ length: 35 }, (_, i) => row(i, 2025))];
  const baseline = Object.fromEntries(rows.filter((item) => item.season === 2025).slice(0, 7).map((item) => [item.gameId, 0]));
  const result = evaluateAdvancedChallenger({ concept: "independent_football", family: "spread", algorithm: "elastic_net", rows, featureNames: ["team_form.a", "team_form.b"], baselinePredictions: baseline });
  assert.equal(result.eligibleHoldoutSampleSize, 35);
  assert.equal(result.pairedSampleSize, 7);
  assert.equal(result.baselineMetrics?.sampleSize, 7);
});

test("locked baseline selection filters family/version and rejects duplicate IDs", () => {
  const rows = [
    { family: "spread", modelVersion: "keep", testSeason: 2025, gameId: "a", predictedValue: 1 },
    { family: "spread", modelVersion: "other", testSeason: 2025, gameId: "b", predictedValue: 2 },
    { family: "moneyline", modelVersion: "ml", testSeason: 2025, gameId: "a", predictedValue: 0.6 },
    { family: "moneyline", modelVersion: "ml", testSeason: 2025, gameId: "a", predictedValue: 0.7 },
  ];
  const selected = selectLockedBaselinePredictions(rows, { spread: "keep", moneyline: "ml" });
  assert.deepEqual(selected.get("spread"), { a: 1 });
  assert.equal(selected.has("moneyline"), false);
});

test("exact paired evidence takes precedence over aggregate source drift", () => {
  const paired = applyReferenceAvailability(
    { verdict: "MATERIAL IMPROVEMENT", verdictStatus: "measured_against_locked_phase6_evidence", comparisonMode: "exact_game_paired_predictions" },
    { hasPairedPredictions: true, aggregateSourceComparable: false },
  );
  assert.equal(paired.verdict, "MATERIAL IMPROVEMENT");
  assert.equal(paired.comparisonMode, "exact_game_paired_predictions");

  const unpaired = applyReferenceAvailability(
    { verdict: "MATERIAL IMPROVEMENT", comparisonMode: "initial" },
    { hasPairedPredictions: false, aggregateSourceComparable: false },
  );
  assert.equal(unpaired.verdict, "NO MATERIAL IMPROVEMENT");
  assert.equal(unpaired.comparisonMode, "non_comparable_aggregate");
});