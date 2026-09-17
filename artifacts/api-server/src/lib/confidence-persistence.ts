import { db, confidenceMethodologiesTable, predictionConfidenceResultsTable } from "@workspace/db";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { CONFIDENCE_HISTORICAL_EVIDENCE, CONFIDENCE_NORMALIZATION, CONFIDENCE_THRESHOLDS, CONFIDENCE_VERSION, CONFIDENCE_WEIGHTS, methodologyChecksum, type ConfidenceResult } from "./confidence-framework";

export type ConfidenceCalculationAuditInputs = Record<string, unknown>;

export function confidenceEvidenceFingerprint(
  result: ConfidenceResult,
  auditInputs: ConfidenceCalculationAuditInputs = {},
) {
  return createHash("sha256").update(JSON.stringify({
    components: result.components,
    evidence: result.evidence,
    downgradeReasons: result.downgradeReasons,
    auditInputs,
  })).digest("hex");
}

export async function persistConfidenceMethodology(historicalEvidence: Record<string, unknown> = CONFIDENCE_HISTORICAL_EVIDENCE) {
  const checksum = methodologyChecksum();
  const [existing] = await db.select().from(confidenceMethodologiesTable).where(
    eq(confidenceMethodologiesTable.confidenceVersion, CONFIDENCE_VERSION),
  ).limit(1);
  if (existing && existing.checksum !== checksum) {
    throw new Error(`Confidence methodology checksum mismatch for ${CONFIDENCE_VERSION}`);
  }
  const [row] = await db.insert(confidenceMethodologiesTable).values({
    confidenceVersion: CONFIDENCE_VERSION,
    weights: CONFIDENCE_WEIGHTS,
    thresholds: CONFIDENCE_THRESHOLDS,
    normalizationRules: CONFIDENCE_NORMALIZATION,
    historicalEvidence,
    checksum,
  }).onConflictDoNothing().returning();
  return row ?? (await db.select().from(confidenceMethodologiesTable).where(
    eq(confidenceMethodologiesTable.confidenceVersion, CONFIDENCE_VERSION),
  ).limit(1))[0];
}

export async function persistConfidenceResults(
  snapshotKey: string,
  results: ConfidenceResult[],
  auditInputs: Partial<Record<ConfidenceResult["market"], ConfidenceCalculationAuditInputs>> = {},
) {
  if (!results.length) return { inserted: 0, results: [] };
  const inserted = await db.insert(predictionConfidenceResultsTable).values(results.map((result) => ({
    snapshotKey,
    confidenceVersion: CONFIDENCE_VERSION,
    evidenceFingerprint: confidenceEvidenceFingerprint(result, auditInputs[result.market]),
    market: result.market,
    score: result.score,
    label: result.label,
    components: { values: result.components },
    evidence: { ...result.evidence, auditInputs: auditInputs[result.market] ?? {} },
    explanation: result.explanation,
    downgradeReasons: result.downgradeReasons,
    calculatedAt: new Date(result.calculatedAt),
  }))).onConflictDoNothing().returning({ id: predictionConfidenceResultsTable.id });
  const persisted = await db.select().from(predictionConfidenceResultsTable)
    .where(and(
      eq(predictionConfidenceResultsTable.snapshotKey, snapshotKey),
      eq(predictionConfidenceResultsTable.confidenceVersion, CONFIDENCE_VERSION),
    ))
    .orderBy(asc(predictionConfidenceResultsTable.market), asc(predictionConfidenceResultsTable.calculatedAt));
  return { inserted: inserted.length, results: persisted.map((row) => ({
    market: row.market as ConfidenceResult["market"],
    score: row.score,
    label: row.label as ConfidenceResult["label"],
    explanation: row.explanation,
    components: ((row.components as { values?: ConfidenceResult["components"] }).values ?? []),
    evidence: row.evidence as ConfidenceResult["evidence"],
    downgradeReasons: row.downgradeReasons,
    calculatedAt: row.calculatedAt.toISOString(),
  })) };
}