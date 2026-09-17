import { eq } from "drizzle-orm";
import {
  db,
  evaluationBaselineManifestsTable,
  marketBaselineEventsTable,
  modelEvaluationPredictionsTable,
} from "@workspace/db";
import { MARKET_BASELINE_SOURCE_URL, sourceFingerprint } from "./market-baseline";
import { shadowFingerprint } from "./shadow-models";

export const SHADOW_BASELINE_MANIFEST_VERSION = "phase61-retained-2025-v2";
export const RETAINED_BASELINE_SOURCE_CHECKSUM = "bc87373a5d1a578ac07c71cb6a1e50a381d58fae393021b96853a4b8674ae8b8";
export const DIAGNOSED_CURRENT_SOURCE_CHECKSUM = "d8abf68445238746a23d00b95fbd06e50d25fb05efb93e6099ae4cd242b8b4c0";
export const RETAINED_BASELINE_EVALUATION_RUN_ID = "phase6-1-2025-market-baseline-v4-bc87373a5d1a-f289a18f99c4";
export const SHADOW_BASELINE_PARSER_VERSION = "nfldata-games-csv-v1";
export const SHADOW_BASELINE_FILTER_VERSION = "2025-matched-nonneutral-final-v1";
export const SHADOW_BASELINE_EVALUATION_VERSION = "market-baseline-v4";

export type BaselineManifestPayload = {
  manifestVersion: string;
  sourceUri: string;
  sourceChecksum: string;
  parserVersion: string;
  filterVersion: string;
  evaluationVersion: string;
  eligibleGameIds: string[];
  retainedPredictionIds: string[];
  marketEventIds: string[];
};

export function baselineManifestChecksum(payload: BaselineManifestPayload) {
  return shadowFingerprint(payload);
}

export function diagnoseRetainedBaseline(input: {
  currentSourceChecksum: string;
  eligibleGameIds: string[];
  retainedPredictionIds: string[];
  marketEventIds: string[];
}) {
  const contentMatches = input.currentSourceChecksum === RETAINED_BASELINE_SOURCE_CHECKSUM;
  const completeIdentities = input.eligibleGameIds.length === 277
    && input.marketEventIds.length === 285
    && input.retainedPredictionIds.length === 784;
  return {
    status: contentMatches && completeIdentities ? "reproducible" : "irrecoverable_historical_limitation",
    dimensions: {
      content: contentMatches
        ? "retained_source_checksum_matches"
        : "source_bytes_changed_from_retained_checksum",
      retainedSourceChecksum: RETAINED_BASELINE_SOURCE_CHECKSUM,
      diagnosedCurrentSourceChecksum: input.currentSourceChecksum,
      parser: SHADOW_BASELINE_PARSER_VERSION,
      filter: SHADOW_BASELINE_FILTER_VERSION,
      missingRows: completeIdentities
        ? "complete_retained_identity_sets"
        : "accepted_report_did_not_retain_all_prediction_or_event_identities",
    },
    limitation: contentMatches && completeIdentities
      ? null
      : [
        !contentMatches ? "The current source bytes differ from the retained Phase 6.1 checksum." : null,
        !completeIdentities ? "The accepted aggregate report did not retain all historical prediction/event identities." : null,
        "Accepted historical evidence is preserved and missing evidence will not be reconstructed or fabricated.",
      ].filter(Boolean).join(" "),
  } as const;
}

export function assertBaselineReproducible(
  expected: BaselineManifestPayload,
  candidate: BaselineManifestPayload,
) {
  if (baselineManifestChecksum(expected) !== baselineManifestChecksum(candidate)) {
    throw new Error("Baseline manifest is not reproducible; comparable evaluation is blocked.");
  }
}

export async function ensureRetainedBaselineManifest() {
  const [existing] = await db.select().from(evaluationBaselineManifestsTable)
    .where(eq(evaluationBaselineManifestsTable.manifestVersion, SHADOW_BASELINE_MANIFEST_VERSION))
    .limit(1);
  if (existing) return existing;

  const events = await db.select({
    id: marketBaselineEventsTable.id,
    matchedGameId: marketBaselineEventsTable.matchedGameId,
    sourceGameId: marketBaselineEventsTable.sourceGameId,
  }).from(marketBaselineEventsTable)
    .where(eq(marketBaselineEventsTable.runId, RETAINED_BASELINE_EVALUATION_RUN_ID));
  const predictions = await db.select({
    id: modelEvaluationPredictionsTable.id,
    gameId: modelEvaluationPredictionsTable.gameId,
    modelVersion: modelEvaluationPredictionsTable.modelVersion,
  }).from(modelEvaluationPredictionsTable)
    .where(eq(modelEvaluationPredictionsTable.evaluationRunId, RETAINED_BASELINE_EVALUATION_RUN_ID));
  const eligibleGameIds = [...new Set(events.flatMap((row) => row.matchedGameId ? [row.matchedGameId] : []))].sort();
  const retainedPredictionIds = predictions
    .map((row) => `${row.modelVersion}:${row.gameId}:${row.id}`).sort();
  const marketEventIds = events.map((row) => `${row.sourceGameId}:${row.id}`).sort();
  const payload: BaselineManifestPayload = {
    manifestVersion: SHADOW_BASELINE_MANIFEST_VERSION,
    sourceUri: MARKET_BASELINE_SOURCE_URL,
    sourceChecksum: RETAINED_BASELINE_SOURCE_CHECKSUM,
    parserVersion: SHADOW_BASELINE_PARSER_VERSION,
    filterVersion: SHADOW_BASELINE_FILTER_VERSION,
    evaluationVersion: SHADOW_BASELINE_EVALUATION_VERSION,
    eligibleGameIds,
    retainedPredictionIds,
    marketEventIds,
  };
  const diagnosis = diagnoseRetainedBaseline({
    currentSourceChecksum: DIAGNOSED_CURRENT_SOURCE_CHECKSUM,
    eligibleGameIds,
    retainedPredictionIds,
    marketEventIds,
  });
  const [inserted] = await db.insert(evaluationBaselineManifestsTable).values({
    ...payload,
    manifestChecksum: baselineManifestChecksum(payload),
    reproducibilityStatus: diagnosis.status,
    limitation: diagnosis.limitation,
    diagnosis,
  }).onConflictDoNothing({ target: evaluationBaselineManifestsTable.manifestVersion }).returning();
  if (inserted) return inserted;
  return (await db.select().from(evaluationBaselineManifestsTable)
    .where(eq(evaluationBaselineManifestsTable.manifestVersion, SHADOW_BASELINE_MANIFEST_VERSION))
    .limit(1))[0];
}

export async function buildCurrentComparableBaselineCandidate(): Promise<BaselineManifestPayload> {
  const { fetch2025MarketSource } = await import("./market-baseline-run");
  const currentSource = await fetch2025MarketSource();
  const events = await db.select({
    id: marketBaselineEventsTable.id,
    matchedGameId: marketBaselineEventsTable.matchedGameId,
    sourceGameId: marketBaselineEventsTable.sourceGameId,
  }).from(marketBaselineEventsTable)
    .where(eq(marketBaselineEventsTable.runId, RETAINED_BASELINE_EVALUATION_RUN_ID));
  const predictions = await db.select({
    id: modelEvaluationPredictionsTable.id,
    gameId: modelEvaluationPredictionsTable.gameId,
    modelVersion: modelEvaluationPredictionsTable.modelVersion,
  }).from(modelEvaluationPredictionsTable)
    .where(eq(modelEvaluationPredictionsTable.evaluationRunId, RETAINED_BASELINE_EVALUATION_RUN_ID));
  return {
    manifestVersion: SHADOW_BASELINE_MANIFEST_VERSION,
    sourceUri: MARKET_BASELINE_SOURCE_URL,
    sourceChecksum: sourceFingerprint(currentSource.csv),
    parserVersion: SHADOW_BASELINE_PARSER_VERSION,
    filterVersion: SHADOW_BASELINE_FILTER_VERSION,
    evaluationVersion: SHADOW_BASELINE_EVALUATION_VERSION,
    eligibleGameIds: [...new Set(events.flatMap((row) => row.matchedGameId ? [row.matchedGameId] : []))].sort(),
    retainedPredictionIds: predictions.map((row) => `${row.modelVersion}:${row.gameId}:${row.id}`).sort(),
    marketEventIds: events.map((row) => `${row.sourceGameId}:${row.id}`).sort(),
  };
}

export async function verifyComparableBaselineOrThrow(candidate: BaselineManifestPayload) {
  const manifest = await ensureRetainedBaselineManifest();
  if (!manifest || manifest.reproducibilityStatus !== "reproducible") {
    throw new Error("Retained Phase 6.1 baseline has an irrecoverable historical limitation; comparable evaluation is blocked.");
  }
  assertBaselineReproducible({
    manifestVersion: manifest.manifestVersion,
    sourceUri: manifest.sourceUri,
    sourceChecksum: manifest.sourceChecksum,
    parserVersion: manifest.parserVersion,
    filterVersion: manifest.filterVersion,
    evaluationVersion: manifest.evaluationVersion,
    eligibleGameIds: manifest.eligibleGameIds,
    retainedPredictionIds: manifest.retainedPredictionIds,
    marketEventIds: manifest.marketEventIds,
  }, candidate);
  return manifest;
}