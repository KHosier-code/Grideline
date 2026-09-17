import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateConfidence,
  cutoffSafeRevisions,
  CONFIDENCE_THRESHOLDS,
  normalizeMarketEdge,
  normalizeModelConfidence,
  buildConsumerConfidence,
  freshConfidenceQuotes,
  projectionRevisionStability,
  snapshotDataConfidence,
  startersResolvedFromEvidence,
  supportedBooksAgree,
} from "./confidence-framework";

const base = {
  market: "spread" as const, dataScore: 90, modelScore: 90, marketDifference: 7,
  marketFresh: true, bookCount: 2, booksAgree: true, snapshotValid: true,
  artifactVerified: true, startersResolved: true, dataAcceptable: true,
};

test("confidence normalization has documented bounded endpoints", () => {
  assert.equal(normalizeModelConfidence(2), 100);
  assert.equal(normalizeModelConfidence(20), 0);
  assert.equal(normalizeMarketEdge(0), 0);
  assert.equal(normalizeMarketEdge(7), 100);
  assert.equal(calculateConfidence(base).label, "Very Strong");
  assert.ok(calculateConfidence({ ...base, marketDifference: 0 }).score < calculateConfidence(base).score);
});

test("missing and stale evidence fails closed with explicit reasons", () => {
  const result = calculateConfidence({ ...base, snapshotValid: false, artifactVerified: false, marketFresh: false, bookCount: 0, booksAgree: false });
  assert.equal(result.label, "Low");
  assert.ok(result.downgradeReasons.some((reason) => /snapshot/i.test(reason)));
  assert.ok(result.downgradeReasons.some((reason) => /artifact/i.test(reason)));
  assert.ok(result.downgradeReasons.some((reason) => /stale/i.test(reason)));
});

test("Data Confidence fails closed for low-sample or incomplete snapshot inputs", () => {
  assert.deepEqual(snapshotDataConfidence({
    qbConfidence: 1,
    lowSample: true,
    inputFeatureCount: 27,
    inputMissingFeatureCount: 0,
  }), { score: 49, acceptable: false });
  assert.deepEqual(snapshotDataConfidence({
    qbConfidence: 1,
    lowSample: false,
    inputFeatureCount: 27,
    inputMissingFeatureCount: 3,
  }), { score: 88.88888888888889, acceptable: false });
});

test("book agreement is market-aware and requires both supported books", () => {
  assert.equal(supportedBooksAgree("spread", [
    { sportsbook: "DraftKings", point: -3, price: -110 },
    { sportsbook: "FanDuel", point: -3.5, price: -105 },
  ]), true);
  assert.equal(supportedBooksAgree("spread", [
    { sportsbook: "DraftKings", point: -3, price: -110 },
    { sportsbook: "FanDuel", point: -4, price: -105 },
  ]), false);
  assert.equal(supportedBooksAgree("moneyline", [
    { sportsbook: "DraftKings", point: null, price: -150 },
    { sportsbook: "FanDuel", point: null, price: -145 },
  ]), true);
});

test("only fresh book observations receive coverage and agreement credit", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const quotes = [
    { sportsbook: "DraftKings", point: -3, price: -110, capturedAt: "2026-09-17T11:55:00Z" },
    { sportsbook: "FanDuel", point: -3, price: -105, capturedAt: "2026-09-17T10:00:00Z" },
  ];
  assert.deepEqual(freshConfidenceQuotes(quotes, now).map((quote) => quote.sportsbook), ["DraftKings"]);
  const result = buildConsumerConfidence({
    snapshot: { snapshotKey: "s", predictionTimestamp: now, verifiedArtifacts: { spread: true } },
    dataConfidence: { score: 90 },
    comparisons: [{ market: "spread", difference: 7, state: "available", currentQuotes: quotes }],
    calculatedAt: now,
    startersResolved: true,
    modelScores: { spread: 90 },
  }).markets[0];
  assert.equal(result.label, "Moderate");
  assert.equal(result.evidence.bookCount, 1);
  assert.equal(result.evidence.booksAgree, false);
  assert.ok(result.downgradeReasons.some((reason) => /fewer than two/i.test(reason)));
});

test("starter and revision evidence fail closed and remain market-specific", () => {
  assert.equal(startersResolvedFromEvidence({ rows: [
    { qbDataConfidence: 1 }, { qbDataConfidence: 0.8 },
  ] }), true);
  assert.equal(startersResolvedFromEvidence({ rows: [
    { qbDataConfidence: 1 }, { qbDataConfidence: 0.5 },
  ] }), false);
  const revisions = [
    { projectedMargin: 3, projectedTotal: 44, homeWinProbability: 0.55 },
    { projectedMargin: 3.1, projectedTotal: 50, homeWinProbability: 0.56 },
  ];
  assert.ok((projectionRevisionStability("spread", revisions) ?? 0)
    > (projectionRevisionStability("total", revisions) ?? 100));
});

test("revision stability excludes evidence after the selected snapshot or kickoff", () => {
  const revisions = [
    { predictionTimestamp: new Date("2026-09-10T10:00:00Z"), projectedMargin: 3 },
    { predictionTimestamp: new Date("2026-09-10T11:00:00Z"), projectedMargin: 3.2 },
    { predictionTimestamp: new Date("2026-09-10T13:30:00Z"), projectedMargin: 14 },
  ];
  const eligible = cutoffSafeRevisions(
    revisions,
    new Date("2026-09-10T11:00:00Z"),
    new Date("2026-09-10T13:00:00Z"),
  );
  assert.deepEqual(eligible.map((row) => row.projectedMargin), [3, 3.2]);
});

test("consumer output keeps market results separate and omits normalization internals", () => {
  const calculatedAt = new Date("2026-09-17T12:00:00Z");
  const result = buildConsumerConfidence({
    snapshot: { snapshotKey: "s", predictionTimestamp: calculatedAt, qbConfidence: 0.9, inputFeatureCount: 10, inputMissingFeatureCount: 0, spreadModelVersion: "a", moneylineModelVersion: "b", totalsModelVersion: "c", verifiedArtifacts: { spread: true, moneyline: true, total: true } },
    dataConfidence: { score: 90 },
    comparisons: [
      { market: "spread", difference: 5, state: "available", currentQuotes: [{ sportsbook: "DraftKings", point: -3, price: -110, capturedAt: "2026-09-17T11:55:00Z" }, { sportsbook: "FanDuel", point: -3, price: -105, capturedAt: "2026-09-17T11:55:00Z" }] },
      { market: "moneyline", difference: 3, state: "available", currentQuotes: [{ sportsbook: "DraftKings", point: null, price: -150, capturedAt: "2026-09-17T11:55:00Z" }, { sportsbook: "FanDuel", point: null, price: -145, capturedAt: "2026-09-17T11:55:00Z" }] },
      { market: "total", difference: 10, state: "stale", currentQuotes: [] },
    ],
    startersResolved: true,
    modelScores: { spread: 80, moneyline: 75, total: 70 },
    calculatedAt,
  });
  assert.deepEqual(result.markets.map((market) => market.market), ["spread", "moneyline", "total"]);
  assert.equal(JSON.stringify(result).includes("normalization"), false);
  assert.equal(JSON.stringify(result).includes("confidence-v1"), false);
});