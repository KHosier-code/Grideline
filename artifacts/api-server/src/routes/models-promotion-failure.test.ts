import test from "node:test";
import assert from "node:assert/strict";
import { createPromotionHandler } from "./models";
import { PromotionSafetyGateError } from "../lib/promotion-safety-gate";
import {
  artifactIdentityFor,
  PHASE6_VECTOR_FEATURE_NAMES,
  PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  type FittedModelArtifact,
} from "../lib/modeling";
import { modelPromotionHistoryTable, modelTrainingRunsTable } from "@workspace/db";

type TrainingRun = typeof modelTrainingRunsTable.$inferSelect;
type Promotion = typeof modelPromotionHistoryTable.$inferSelect;
const modelArtifact: FittedModelArtifact = {
  version: 1 as const,
  algorithm: "linear_regression",
  centers: Array(27).fill(0),
  scales: Array(27).fill(1),
  model: { kind: "linear", coefficients: Array(28).fill(0) },
};
modelArtifact.metadata = artifactIdentityFor(modelArtifact, {
  family: "spread",
  algorithm: "linear_regression",
  featureVersion: "pregame-v3",
  vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
  vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  trainingSeasons: [2021, 2022, 2023, 2024, 2025],
  trainingCutoff: "2025-12-31T23:59:59.999Z",
  samplePolicy: "include_low_sample",
  hyperparameters: { ridgeLambda: 1 },
  randomSeed: null,
  trainingSampleCount: 100,
});

const candidate: TrainingRun = {
  id: 10,
  modelVersion: `phase6-1-spread-${modelArtifact.metadata.artifactChecksum.slice(0, 24)}`,
  family: "spread",
  algorithm: "linear_regression",
  featureVersion: "pregame-v3",
  trainingSeasons: [2021, 2022, 2023, 2024, 2025],
  testSeason: 2025,
  samplePolicy: "include_low_sample",
  recencyWeighting: "none",
  status: "refit_candidate",
  sampleSize: 100,
  metrics: { outputValidation: "finite", historicalComparisonClassification: "materially_consistent" },
  calibration: {},
  featureImportance: {},
  vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
  vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  modelArtifact,
  notes: null,
  trainedAt: new Date("2026-09-14T12:00:00.000Z"),
};

const existingPromotion: Promotion = {
  id: 1,
  family: "spread",
  modelVersion: "phase4-spread-linear_regression-2025-include_low_sample-test",
  algorithm: "linear_regression",
  featureVersion: "pregame-v3",
  trainingCutoff: "through-2024",
  role: "production",
  promotedAt: new Date("2026-09-01T12:00:00.000Z"),
  promotedBy: "existing-admin",
  reason: null,
};

test("a failed safety gate returns 412 without changing production state", async () => {
  const history = [existingPromotion];
  let insertCalls = 0;
  let snapshotGenerationCalls = 0;
  let statusCode = 200;
  const captured: { body?: Record<string, unknown> } = {};
  const checkedAt = "2026-09-14T15:00:00.000Z";

  const handler = createPromotionHandler({
    findRun: async () => candidate,
    runSafetyGate: async () => {
      throw new PromotionSafetyGateError({
        status: "failed",
        checkedAt,
        candidateModelVersion: candidate.modelVersion,
        predictionValidation: { passed: 7, total: 8 },
        leakage: { passed: 7, total: 7 },
        failureDetails: ["intentional prediction-validation failure"],
      });
    },
    insertPromotion: async () => {
      insertCalls += 1;
      throw new Error("insert must not be called");
    },
    findCurrentPromotion: async () => history[0],
    generateRevision: async () => {
      snapshotGenerationCalls += 1;
      return { status: "unexpected" } as never;
    },
    verifyCurrentInference: async () => ({ passed: true, returned: 6, vectorsDiffer: true }),
    getPromotedBy: () => "test-admin",
  });

  const req = {
    body: { modelVersion: candidate.modelVersion },
    log: { error: () => undefined },
  };
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };

  await handler(req as never, res as never);

  assert.equal(statusCode, 412);
  assert.equal(insertCalls, 0);
  assert.equal(snapshotGenerationCalls, 0);
  assert.deepEqual(history, [existingPromotion]);
  assert.equal(captured.body?.error, "Promotion blocked: the prediction safety gate failed. No promotion was recorded.");
  assert.deepEqual(captured.body?.safetyGate, {
    status: "failed",
    checkedAt,
    candidateModelVersion: candidate.modelVersion,
    predictionValidation: { passed: 7, total: 8 },
    leakage: { passed: 7, total: 7 },
    failureDetails: ["intentional prediction-validation failure"],
  });
});