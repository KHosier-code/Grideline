import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_EVALUATION_CUTOFF_MINUTES,
  canonicalEvaluationCutoff,
  canonicalFreezeWindowOpen,
  isCanonicalOfficialPrediction,
  canonicalMarketEvidenceSnapshot,
  canonicalSnapshotReady,
  hasCompleteCanonicalMarketEvidence,
  canonicalMarketEligibility,
  canonicalOfficialComparison,
  recordCanonicalFreezeCandidate,
} from "./live-predictions";

test("a historical post-kickoff official flag is not reportable or gradable", () => {
  const kickoff = new Date("2026-09-20T17:00:00Z");
  const legacy = {
    officialFinalPrediction: true,
    kickoffTime: kickoff,
    frozenAt: new Date("2026-09-20T17:00:01Z"),
    evaluationCutoffAt: null,
  };
  assert.equal(isCanonicalOfficialPrediction(legacy as any, kickoff,
    new Date("2026-09-21T00:00:00Z")), false);
  assert.equal(isCanonicalOfficialPrediction({ ...legacy, frozenAt: new Date("2026-09-20T16:30:00Z"),
    evaluationCutoffAt: new Date("2026-09-20T16:59:00Z") } as any, kickoff,
  new Date("2026-09-21T00:00:00Z")), false);
});

const quote = (
  capturedAt: string,
  market: string,
  sportsbook: string,
  selection: string,
  point: number | null = -3,
) => ({
  market,
  sportsbook,
  selection,
  price: -110,
  point,
  capturedAt,
});

function evidence(capturedAt = "2026-09-10T15:20:00.000Z") {
  const spread = [
    quote(capturedAt, "spread", "DraftKings", "Home", -3),
    quote(capturedAt, "spread", "DraftKings", "Away", 3),
    quote(capturedAt, "spread", "FanDuel", "Home", -3),
    quote(capturedAt, "spread", "FanDuel", "Away", 3),
  ];
  const moneyline = [
    quote(capturedAt, "moneyline", "DraftKings", "Home", null),
    quote(capturedAt, "moneyline", "DraftKings", "Away", null),
    quote(capturedAt, "moneyline", "FanDuel", "Home", null),
    quote(capturedAt, "moneyline", "FanDuel", "Away", null),
  ];
  const total = [
    quote(capturedAt, "total", "DraftKings", "Over", 44.5),
    quote(capturedAt, "total", "DraftKings", "Under", 44.5),
    quote(capturedAt, "total", "FanDuel", "Over", 44.5),
    quote(capturedAt, "total", "FanDuel", "Under", 44.5),
  ];
  return {
    markets: {
      spread: { draftKings: spread[0], fanDuel: spread[1], quotes: spread },
      moneyline: { draftKings: moneyline[0], fanDuel: moneyline[2], quotes: moneyline },
      total: { draftKings: total[0], fanDuel: total[1], bestAvailable: total[0], quotes: total },
    },
  };
}

test("canonical market evidence requires every supported book and market before cutoff", () => {
  const cutoff = new Date("2026-09-10T15:30:00.000Z");
  assert.equal(hasCompleteCanonicalMarketEvidence(evidence(), cutoff), true);
  const missingBook = evidence();
  (missingBook.markets.spread as Record<string, any>).quotes =
    (missingBook.markets.spread as Record<string, any>).quotes
      .filter((row: { sportsbook: string }) => row.sportsbook !== "FanDuel");
  assert.equal(hasCompleteCanonicalMarketEvidence(missingBook, cutoff), false);
  const missingMoneylineOutcome = evidence();
  (missingMoneylineOutcome.markets.moneyline as Record<string, unknown>).quotes =
    (missingMoneylineOutcome.markets.moneyline as Record<string, any>).quotes
      .filter((row: { sportsbook: string }) => row.sportsbook !== "FanDuel");
  assert.equal(hasCompleteCanonicalMarketEvidence(missingMoneylineOutcome, cutoff), false);
  assert.equal(
    hasCompleteCanonicalMarketEvidence(evidence("2026-09-10T15:30:00.001Z"), cutoff),
    false,
  );
  assert.equal(
    hasCompleteCanonicalMarketEvidence(evidence("2026-09-10T15:14:59.999Z"), cutoff),
    false,
  );
});

test("canonical cutoff remains a fixed 30-minute pre-kickoff boundary", () => {
  const kickoff = new Date("2026-09-10T16:00:00.000Z");
  const cutoff = new Date(kickoff.getTime() - CANONICAL_EVALUATION_CUTOFF_MINUTES * 60_000);
  assert.equal(CANONICAL_EVALUATION_CUTOFF_MINUTES, 30);
  assert.equal(cutoff.toISOString(), "2026-09-10T15:30:00.000Z");
});

test("official projection freezes at cutoff despite missing or stale odds, never post-cutoff odds", () => {
  const cutoff = new Date("2026-09-10T15:30:00.000Z");
  assert.equal(
    canonicalSnapshotReady(new Date("2026-09-10T15:30:00.001Z"), cutoff, evidence()),
    false,
  );
  assert.equal(
    canonicalSnapshotReady(new Date("2026-09-10T15:00:00.000Z"), cutoff, {}),
    true,
  );
  assert.equal(
    canonicalSnapshotReady(new Date("2026-09-10T15:00:00.000Z"), cutoff, evidence("2026-09-10T15:30:00.001Z")),
    false,
  );
  assert.equal(
    canonicalSnapshotReady(new Date("2026-09-10T15:00:00.000Z"), cutoff, evidence("2026-09-10T15:14:59.999Z")),
    true,
  );
});

test("each official market requires its own fresh paired DraftKings and FanDuel outcomes", () => {
  const cutoff = new Date("2026-09-10T15:30:00.000Z");
  const partial = evidence();
  const markets = partial.markets as Record<string, any>;
  markets.spread.quotes = markets.spread.quotes.filter((row: { sportsbook: string; selection: string }) =>
    row.sportsbook !== "FanDuel" || row.selection !== "Away");
  markets.moneyline.quotes = markets.moneyline.quotes.filter((row: { sportsbook: string }) =>
    row.sportsbook !== "DraftKings");
  const eligibility = canonicalMarketEligibility(partial, cutoff) as Record<string, { eligible: boolean }>;
  assert.equal(eligibility.spread.eligible, false);
  assert.equal(eligibility.total.eligible, true);
  assert.equal(eligibility.moneyline.eligible, false);
  assert.equal(hasCompleteCanonicalMarketEvidence(partial, cutoff), false);
  assert.equal(canonicalMarketEligibility({}, cutoff).spread.eligible, false);
  const comparison = canonicalOfficialComparison(partial, 4, 45, 0.6, cutoff);
  assert.equal(comparison.spread.marketLine, null);
  assert.equal(comparison.spread.marketAvailable, false);
  assert.equal(comparison.moneyline.noVigHomeProbability, null);
  assert.equal(comparison.totals.marketAvailable, true);
});

test("freeze timing allows only a pre-kickoff prediction at or before the fixed cutoff", () => {
  const kickoff = new Date("2026-09-10T16:00:00.000Z");
  const cutoff = new Date("2026-09-10T15:30:00.000Z");
  assert.equal(canonicalFreezeWindowOpen(cutoff, kickoff, cutoff), true);
  assert.equal(canonicalFreezeWindowOpen(new Date(cutoff.getTime() + 1), kickoff, cutoff), false);
  assert.equal(canonicalFreezeWindowOpen(cutoff, kickoff, new Date(cutoff.getTime() - 1)), false);
  assert.equal(canonicalFreezeWindowOpen(cutoff, kickoff, kickoff), false);
  assert.equal(canonicalFreezeWindowOpen(cutoff, kickoff, new Date(kickoff.getTime() + 1)), false);
});

test("a prior kickoff-flex cutoff can only tighten the fixed cutoff", () => {
  const kickoff = new Date("2026-09-10T16:00:00.000Z");
  const fixedCutoff = new Date("2026-09-10T15:30:00.000Z");
  const priorCutoff = new Date("2026-09-10T15:10:00.000Z");
  const laterOverride = new Date("2026-09-10T15:45:00.000Z");
  assert.equal(canonicalEvaluationCutoff(kickoff, priorCutoff).toISOString(), priorCutoff.toISOString());
  assert.equal(canonicalEvaluationCutoff(kickoff, laterOverride).toISOString(), fixedCutoff.toISOString());
  assert.equal(
    canonicalFreezeWindowOpen(priorCutoff, kickoff, priorCutoff, priorCutoff),
    true,
  );
  assert.equal(
    canonicalFreezeWindowOpen(fixedCutoff, kickoff, fixedCutoff, priorCutoff),
    false,
  );
  assert.equal(
    canonicalFreezeWindowOpen(priorCutoff, kickoff, priorCutoff, laterOverride),
    false,
  );
  assert.equal(canonicalFreezeWindowOpen(priorCutoff, kickoff, kickoff, priorCutoff), false);
});

test("one game selects at most one official candidate despite duplicate pending snapshots", () => {
  const selected = new Map<string, { snapshotKey: string }>();
  assert.equal(recordCanonicalFreezeCandidate(selected, "game-1", { snapshotKey: "latest" }), true);
  assert.equal(recordCanonicalFreezeCandidate(selected, "game-1", { snapshotKey: "older" }), false);
  assert.equal(selected.size, 1);
  assert.equal(selected.get("game-1")?.snapshotKey, "latest");
});

test("canonical evidence retains historical prediction-time market and confidence evidence", () => {
  const predictionMarket = { markets: { spread: { original: true } } };
  const predictionComparison = { spread: { pointEdge: 2.5 } };
  const canonicalMarket = evidence();
  const canonicalComparison = { spread: { pointEdge: 1.5 } };
  const frozen = canonicalMarketEvidenceSnapshot(
    predictionMarket,
    predictionComparison,
    canonicalMarket,
    canonicalComparison,
    {
      cutoffAt: new Date("2026-09-10T15:30:00.000Z"),
      frozenAt: new Date("2026-09-10T15:30:02.000Z"),
      candidate: {
        snapshotKey: "game-1:pre-kickoff",
        predictionTimestamp: new Date("2026-09-10T15:00:00.000Z"),
        qbConfidence: 0.8,
        lowSample: false,
        inputFeatureCount: 12,
        inputMissingFeatureCount: 0,
        homeWinProbability: 0.6,
        awayWinProbability: 0.4,
      },
    },
  );
  assert.deepEqual((frozen.predictionTimeEvidence as Record<string, unknown>).marketSnapshot, predictionMarket);
  assert.deepEqual((frozen.predictionTimeEvidence as Record<string, unknown>).marketComparison, predictionComparison);
  assert.deepEqual(frozen.markets, canonicalMarket.markets);
  assert.deepEqual((frozen.canonicalEvaluation as Record<string, unknown>).canonicalComparison, canonicalComparison);
  assert.deepEqual((frozen.canonicalEvaluation as Record<string, any>).confidence, {
    qbConfidence: 0.8,
    lowSample: false,
    inputFeatureCount: 12,
    inputMissingFeatureCount: 0,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
  });
  assert.deepEqual(predictionMarket, { markets: { spread: { original: true } } });
  assert.deepEqual(predictionComparison, { spread: { pointEdge: 2.5 } });
});
