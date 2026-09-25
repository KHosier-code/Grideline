import { and, eq } from "drizzle-orm";
import { db, gamesTable, predictionSnapshotsTable } from "@workspace/db";
import { validatePredictionOutputs } from "./prediction-validation";
import { isCanonicalOfficialPrediction } from "./live-predictions";

export function correctionSnapshotKey(officialKey: string, correctionId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(correctionId)) {
    throw new Error("A correction requires a stable alphanumeric identifier.");
  }
  return `${officialKey}:post-kickoff-correction:${correctionId}`;
}

/**
 * A correction is another explicitly labeled, non-official snapshot. It can
 * never replace the immutable official row or enter pre-kickoff selection.
 * Only a trusted, authorized caller may invoke this service.
 */
export async function appendOfficialPredictionCorrection(input: {
  officialSnapshotKey: string;
  correctionId: string;
  reason: string;
  recordedBy: string;
  corrected: {
    projectedHomeScore: number;
    projectedAwayScore: number;
    projectedMargin: number;
    projectedTotal: number;
    homeWinProbability: number;
    awayWinProbability: number;
  };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || !input.reason.trim() || !input.recordedBy.trim()
    || input.reason.length > 500 || input.recordedBy.length > 200) {
    throw new Error("A correction requires a valid time, author, and short explanation.");
  }
  const key = correctionSnapshotKey(input.officialSnapshotKey, input.correctionId);
  if (validatePredictionOutputs(input.corrected).length) {
    throw new Error("Corrected outputs must be complete, finite and internally consistent.");
  }
  const [official] = await db.select().from(predictionSnapshotsTable).where(and(
    eq(predictionSnapshotsTable.snapshotKey, input.officialSnapshotKey),
    eq(predictionSnapshotsTable.officialFinalPrediction, true),
  )).limit(1);
  if (!official?.kickoffTime || !official.frozenAt) {
    throw new Error("An immutable official prediction must exist before recording a correction.");
  }
  const [game] = await db.select({ kickoffTime: gamesTable.kickoffTime }).from(gamesTable)
    .where(eq(gamesTable.gameId, official.gameId)).limit(1);
  const currentKickoff = game?.kickoffTime ?? official.kickoffTime;
  if (!isCanonicalOfficialPrediction(official, currentKickoff, now)) {
    throw new Error("Corrections require a verified canonical official prediction.");
  }
  if (now < currentKickoff) {
    throw new Error("Corrections cannot be saved before kickoff.");
  }
  const [inserted] = await db.insert(predictionSnapshotsTable).values({
    snapshotKey: key,
    gameId: official.gameId,
    predictionTimestamp: now,
    snapshotLabel: "post-kickoff-correction",
    kickoffTime: official.kickoffTime,
    featureVersion: official.featureVersion,
    spreadModelVersion: official.spreadModelVersion,
    moneylineModelVersion: official.moneylineModelVersion,
    totalsModelVersion: official.totalsModelVersion,
    trainingCutoff: official.trainingCutoff,
    ...input.corrected,
    marketSnapshot: official.marketSnapshot,
    marketComparison: official.marketComparison,
    lowSample: official.lowSample,
    qbConfidence: official.qbConfidence,
    inputFeatureCount: official.inputFeatureCount,
    inputMissingFeatureCount: official.inputMissingFeatureCount,
    inputVector: official.inputVector,
    vectorFeatureNames: official.vectorFeatureNames,
    vectorSchemaFingerprint: official.vectorSchemaFingerprint,
    inputSourceEvidence: {
      ...official.inputSourceEvidence,
      correction: {
        label: "Post-kickoff correction — not an official prediction",
        officialSnapshotKey: official.snapshotKey,
        correctionId: input.correctionId,
        reason: input.reason.trim(),
        recordedBy: input.recordedBy.trim(),
        recordedAt: now.toISOString(),
      },
    },
    officialFinalPrediction: false,
  }).onConflictDoNothing({ target: predictionSnapshotsTable.snapshotKey })
    .returning({ snapshotKey: predictionSnapshotsTable.snapshotKey });
  return { snapshotKey: key, created: Boolean(inserted), label: "post-kickoff-correction" as const };
}