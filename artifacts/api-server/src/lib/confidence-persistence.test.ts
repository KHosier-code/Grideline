import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "@workspace/db";
import { confidenceEvidenceFingerprint } from "./confidence-persistence";
import type { ConfidenceResult } from "./confidence-framework";

test("evidence fingerprints ignore execution time and change with canonical inputs", () => {
  const result: ConfidenceResult = {
    market: "spread",
    score: 60,
    label: "Moderate",
    explanation: "Moderate confidence.",
    components: [
      { key: "data", label: "Data Confidence", score: 80, summary: "80/100 input quality" },
      { key: "model", label: "Model Confidence", score: 70, summary: "70/100 stability/error evidence" },
      { key: "marketEdge", label: "Market Edge Strength", score: 60, summary: "60/100 difference, freshness, and consensus" },
    ],
    evidence: {
      marketDifference: 3,
      marketFresh: true,
      bookCount: 2,
      booksAgree: true,
      agreementTolerance: "point within 0.5 and American price within 10",
      historical: { status: "insufficient" },
      gates: { snapshotValid: true, artifactVerified: true, startersResolved: true, dataAcceptable: true },
    },
    downgradeReasons: [],
    calculatedAt: "2026-09-17T12:00:00.000Z",
  };
  const audit = { quotes: [{ sportsbook: "DraftKings", point: -3, price: -110, capturedAt: "2026-09-17T11:55:00Z" }] };
  const later = { ...result, calculatedAt: "2026-09-17T12:05:00.000Z" };
  assert.equal(confidenceEvidenceFingerprint(result, audit), confidenceEvidenceFingerprint(later, audit));
  assert.notEqual(
    confidenceEvidenceFingerprint(result, audit),
    confidenceEvidenceFingerprint(result, { quotes: [{ ...audit.quotes[0], point: -3.5 }] }),
  );
});

test("confidence methodology and market results are append-only and version-separated", async () => {
  const version = `confidence-integration-${randomUUID()}`;
  const snapshotKey = `snapshot-${randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO confidence_methodologies
        (confidence_version, weights, thresholds, normalization_rules, historical_evidence, checksum)
       VALUES ($1, '{"data":0.35,"model":0.35,"market":0.30}'::jsonb,
        '{"moderate":50,"strong":70,"veryStrong":85}'::jsonb,
        '{"data":"test","model":"test","market":"test"}'::jsonb,
        '{"status":"insufficient"}'::jsonb, 'integration-checksum')`,
      [version],
    );
    await client.query(
      `INSERT INTO prediction_confidence_results
        (snapshot_key, confidence_version, evidence_fingerprint, market, score, label, components, evidence, explanation)
       VALUES ($1, $2, 'integration-evidence', 'spread', 49, 'Low', '{"values":[]}'::jsonb,
        '{"historical":{"status":"insufficient"}}'::jsonb, 'Integration result')`,
      [snapshotKey, version],
    );
    const duplicate = await client.query(
      `INSERT INTO prediction_confidence_results
        (snapshot_key, confidence_version, evidence_fingerprint, market, score, label, components, evidence, explanation)
       VALUES ($1, $2, 'integration-evidence', 'spread', 49, 'Low', '{"values":[]}'::jsonb,
        '{"historical":{"status":"insufficient"}}'::jsonb, 'Integration result')
       ON CONFLICT DO NOTHING RETURNING id`,
      [snapshotKey, version],
    );
    assert.equal(duplicate.rowCount, 0);
    const changed = await client.query(
      `INSERT INTO prediction_confidence_results
        (snapshot_key, confidence_version, evidence_fingerprint, market, score, label, components, evidence, explanation)
       VALUES ($1, $2, 'changed-evidence', 'spread', 49, 'Low', '{"values":[]}'::jsonb,
        '{"historical":{"status":"insufficient"},"marketFresh":false}'::jsonb, 'Changed result')
       ON CONFLICT DO NOTHING RETURNING id`,
      [snapshotKey, version],
    );
    assert.equal(changed.rowCount, 1);
    await assert.rejects(
      () => client.query(
        "UPDATE prediction_confidence_results SET score = 90 WHERE snapshot_key = $1",
        [snapshotKey],
      ),
      /append-only/i,
    );
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO confidence_methodologies
        (confidence_version, weights, thresholds, normalization_rules, checksum)
       VALUES ($1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'integration-checksum')`,
      [version],
    );
    await assert.rejects(
      () => client.query(
        "UPDATE confidence_methodologies SET checksum = 'changed' WHERE confidence_version = $1",
        [version],
      ),
      /append-only/i,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});