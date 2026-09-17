import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPersonnelChronology,
  buildPersonnelComparisonPreflight,
  buildPersonnelComparisonReport,
  pairedUncertainty,
  personnelComparisonFingerprint,
  personnelVector,
} from "./personnel-comparison";
import { renderPersonnelComparisonMarkdown } from "./personnel-comparison-markdown";

test("personnel vectors are home-away differences and reject post-kickoff evidence", () => {
  const row = {
    gameId: "g",
    kickoffTime: new Date("2025-09-07T17:00:00Z"),
    sourceCutoff: new Date("2025-09-07T16:00:00Z"),
    homeTeamId: "home",
    awayTeamId: "away",
    personnel: {
      "personnel.data_confidence": 80,
      "personnel.home.starter_count": 14,
      "personnel.away.starter_count": 12,
      "personnel.home.personnel_completeness": 90,
      "personnel.away.personnel_completeness": 70,
    },
  };
   const vector = personnelVector(row);
   assert.equal(vector[2], 2);
   assert.equal(vector[4], 20);
  assert.throws(() => assertPersonnelChronology([{ kickoffTime: row.kickoffTime, sourceCutoff: new Date("2025-09-08") }]), /strictly before kickoff/);
});

test("paired report keeps exact game set and exposes uncertainty without threshold advice", () => {
  const date = new Date("2025-09-07T17:00:00Z");
  const predictions = ["a", "b"].map((gameId, index) => ({
    gameId,
    week: index + 1,
    family: "spread" as const,
    kickoffTime: date,
    personnelSourceCutoff: new Date("2025-09-07T16:00:00Z"),
    actual: 3,
    baseline: 1,
    challenger: 2,
  }));
  const report = buildPersonnelComparisonReport({
    baselineRunId: "baseline",
    eligibleGameIds: ["a", "b"],
    minimumRecordedLineEdge: 1,
    predictions,
  });
  assert.equal(report.gameSet.exactMatch, true);
  assert.equal(
    (report.models[0]!.pairedDelta as { mae: { sampleSize: number } }).mae.sampleSize,
    2,
  );
  assert.match(report.suitability.reason, /no pre-registered threshold/);
  assert.equal(pairedUncertainty([1]).status, "insufficient_sample");
  assert.equal(report.models[0]!.verdict, "NO MATERIAL IMPROVEMENT");
  assert.equal(report.models[0]!.comparison.mae.difference, -1);
  assert.equal(report.models[0]!.comparison.mae.improvementPercent, 50);
  assert.deepEqual(report.models[0]!.market?.baselineRecord, { wins: 0, losses: 0, pushes: 0, noBets: 0, winRate: null });
  assert.equal(report.safeguards.productionPredictionMutation, false);
});

test("family-specific pairing is exact and deterministic report content is complete", () => {
  const date = new Date("2025-09-07T17:00:00Z");
  const common = { week: 1, kickoffTime: date, personnelSourceCutoff: new Date("2025-09-07T16:00:00Z") };
  const predictions = [
    { ...common, gameId: "spread-a", family: "spread" as const, actual: 3, baseline: 1, challenger: 2, marketQuotes: [{ family: "spread", side: "home", point: -1, price: -110 }] },
    { ...common, gameId: "ml-a", family: "moneyline" as const, actual: 1, baseline: 0.6, challenger: 0.7, marketQuotes: [{ family: "moneyline", side: "home", point: null, price: -150 }, { family: "moneyline", side: "away", point: null, price: 130 }] },
    { ...common, gameId: "total-a", family: "totals" as const, actual: 44, baseline: 40, challenger: 42, marketQuotes: [{ family: "totals", side: "over", point: 41, price: -110 }] },
  ];
  const report = buildPersonnelComparisonReport({
    baselineRunId: "baseline",
    eligibleGameIds: predictions.map((row) => row.gameId),
    eligibleGameIdsByFamily: { spread: ["spread-a"], moneyline: ["ml-a"], totals: ["total-a"] },
    minimumRecordedLineEdge: 1,
    predictions,
  });
  assert.deepEqual(report.models.map((model) => model.family), ["spread", "moneyline", "totals"]);
  assert.equal(report.models.filter((model) => model.verdict).length, 3);
  assert.ok(report.models.find((model) => model.family === "moneyline")?.calibration);
  assert.ok(report.models.find((model) => model.family === "spread")?.market?.challengerEdgeBuckets);
  assert.equal(report.personnelEvidence.categories.rosterTrade.status, "unavailable");
  const fake = { ...report, evidenceRows: 3, baselineEvidenceImmutable: true };
  const markdown = renderPersonnelComparisonMarkdown(fake);
  assert.match(markdown, /Family verdicts/);
  assert.match(markdown, /No tuning, promotion, production-model change/);
  assert.equal(renderPersonnelComparisonMarkdown(fake), markdown);
  const shuffledReport = buildPersonnelComparisonReport({
    baselineRunId: "baseline",
    eligibleGameIds: predictions.map((row) => row.gameId),
    eligibleGameIdsByFamily: { spread: ["spread-a"], moneyline: ["ml-a"], totals: ["total-a"] },
    minimumRecordedLineEdge: 1,
    predictions: [...predictions].reverse(),
  });
  assert.equal(personnelComparisonFingerprint(report), personnelComparisonFingerprint(
    buildPersonnelComparisonReport({
      baselineRunId: "baseline",
      eligibleGameIds: predictions.map((row) => row.gameId),
      eligibleGameIdsByFamily: { spread: ["spread-a"], moneyline: ["ml-a"], totals: ["total-a"] },
      minimumRecordedLineEdge: 1,
      predictions,
    }),
  ));
  assert.equal(personnelComparisonFingerprint(report), personnelComparisonFingerprint(shuffledReport));
  assert.equal(renderPersonnelComparisonMarkdown({ ...report, evidenceRows: 3, baselineEvidenceImmutable: true }),
    renderPersonnelComparisonMarkdown({ ...shuffledReport, evidenceRows: 3, baselineEvidenceImmutable: true }));
  assert.throws(() => buildPersonnelComparisonReport({
    baselineRunId: "baseline", eligibleGameIds: ["wrong"], eligibleGameIdsByFamily: { spread: ["wrong"] },
    minimumRecordedLineEdge: 1, predictions: [predictions[0]],
  }), /exactly one row/);
});

test("preflight separates missing rows from derived zeroes and blocks chronology violations", () => {
  const kickoffTime = new Date("2025-09-07T17:00:00Z");
  const context = {
    gameId: "g",
    sourceCutoff: "2025-09-07T16:00:00Z",
    teams: {
      home: {
        starters: [{ position: "QB" }],
        qb: { projectedStarter: { playerId: "qb" } },
        injuryPlayers: [],
        injuries: { offense: { impactScore: 0 }, secondary: { impactScore: 0 } },
        olContinuity: { olSnapContinuity: 0.8 },
      },
      away: {
        starters: [],
        qb: { projectedStarter: null },
        injuryPlayers: [],
        injuries: { offense: { impactScore: 0 }, secondary: { impactScore: 0 } },
        olContinuity: { olSnapContinuity: null },
      },
    },
  } as any;
  const preflight = buildPersonnelComparisonPreflight([{ season: 2025, kickoffTime, context }]);
  assert.equal(preflight.status, "warn");
  assert.equal(preflight.coverageBySeason[0]!.categories.injury.availableObservations, 0);
  assert.equal(preflight.coverageBySeason[0]!.categories.injury.derivedZeroWithoutSourceRows, 2);
  assert.ok(preflight.missingCategories.some((row) => row.category === "rosterTrade"));
  assert.equal(preflight.modelFittingPerformed, false);
  assert.equal(preflight.databaseWritesPerformed, false);

  const invalid = buildPersonnelComparisonPreflight([{
    season: 2025,
    kickoffTime,
    context: { ...context, sourceCutoff: kickoffTime.toISOString() },
  }]);
  assert.equal(invalid.status, "block");
  assert.equal(invalid.chronology.valid, false);
});
