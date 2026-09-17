import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_EVALUATION_CUTOFF_MINUTES,
  canonicalSnapshotReady,
  hasCompleteCanonicalMarketEvidence,
} from "./live-predictions";

const quote = (capturedAt: string, point: number | null = -3) => ({
  price: -110,
  point,
  capturedAt,
});

function evidence(capturedAt = "2026-09-10T15:20:00.000Z") {
  return {
    markets: {
      spread: { draftKings: quote(capturedAt), fanDuel: quote(capturedAt) },
      moneyline: { draftKings: quote(capturedAt, null), fanDuel: quote(capturedAt, null) },
      total: { draftKings: quote(capturedAt, 44.5), fanDuel: quote(capturedAt, 44.5) },
    },
  };
}

test("canonical market evidence requires every supported book and market before cutoff", () => {
  const cutoff = new Date("2026-09-10T15:30:00.000Z");
  assert.equal(hasCompleteCanonicalMarketEvidence(evidence(), cutoff), true);
  const missingBook = evidence();
  delete (missingBook.markets.spread as Record<string, unknown>).fanDuel;
  assert.equal(hasCompleteCanonicalMarketEvidence(missingBook, cutoff), false);
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

test("canonical readiness rejects an old model row and accepts an exact cutoff", () => {
  const cutoff = new Date("2026-09-10T15:30:00.000Z");
  assert.equal(
    canonicalSnapshotReady(new Date("2026-09-10T15:30:00.001Z"), cutoff, evidence()),
    false,
  );
  assert.equal(
    canonicalSnapshotReady(new Date("2026-09-10T15:00:00.000Z"), cutoff, evidence("2026-09-10T15:30:00.000Z")),
    true,
  );
});