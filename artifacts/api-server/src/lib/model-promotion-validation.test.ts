import test from "node:test";
import assert from "node:assert/strict";
import { PHASE6_VECTOR_FEATURE_NAMES, PHASE6_VECTOR_SCHEMA_FINGERPRINT, validateProductionCandidate } from "./modeling";
import { modelTrainingRunsTable } from "@workspace/db";

type TrainingRun = typeof modelTrainingRunsTable.$inferSelect;
const modelArtifact = {
  version: 1 as const,
  algorithm: "linear_regression",
  centers: Array(27).fill(0),
  scales: Array(27).fill(1),
  model: { kind: "linear", coefficients: Array(28).fill(0) },
};

function candidate(overrides: Partial<TrainingRun> = {}): TrainingRun {
  return {
    id: 1,
    modelVersion: "phase6-refit-spread-linear_regression-through-2025-test",
    family: "spread",
    algorithm: "linear_regression",
    featureVersion: "pregame-v3",
    trainingSeasons: [2021, 2022, 2023, 2024, 2025],
    testSeason: 2025,
    samplePolicy: "include_low_sample",
    recencyWeighting: "none",
    status: "refit_candidate",
    sampleSize: 100,
    metrics: { outputValidation: "finite" },
    calibration: {},
    featureImportance: {},
    vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
    vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
    modelArtifact,
    notes: null,
    trainedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("accepts the exact Phase 6 production refit policy", () => {
  const validation = validateProductionCandidate(candidate());
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.failures, []);
  assert.equal(validation.trainingCutoff, "through-2025");
});

test("preserves support for the existing historical Phase 4 challenger policy", () => {
  const validation = validateProductionCandidate(candidate({
    modelVersion: "phase4-spread-linear_regression-2025-include_low_sample-none-test",
    trainingSeasons: [2021, 2022, 2023, 2024],
    testSeason: 2025,
    status: "challenger",
    metrics: {},
  }));
  assert.equal(validation.valid, true);
  assert.equal(validation.trainingCutoff, "through-2024");
});

test("rejects a production run with an unsupported status or version family", () => {
  const invalidStatus = validateProductionCandidate(candidate({
    status: "production",
  }));
  assert.equal(invalidStatus.valid, false);
  assert.ok(invalidStatus.failures.some((failure) => failure.includes("status")));

  const invalidVersion = validateProductionCandidate(candidate({
    modelVersion: "experimental-spread-linear_regression",
  }));
  assert.equal(invalidVersion.valid, false);
  assert.ok(invalidVersion.failures.some((failure) => failure.includes("phase6-refit")));
});

test("rejects a Phase 6 run with the wrong family algorithm and sample policy", () => {
  const validation = validateProductionCandidate(candidate({
    family: "totals",
    algorithm: "linear_regression",
    samplePolicy: "include_low_sample",
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.failures.some((failure) => failure.includes("gradient_boosting")));
  assert.ok(validation.failures.some((failure) => failure.includes("exclude_low_sample")));
});

test("rejects same-width ordered feature schema drift", () => {
  const drifted = [...PHASE6_VECTOR_FEATURE_NAMES.slice(1), PHASE6_VECTOR_FEATURE_NAMES[0]];
  const validation = validateProductionCandidate(candidate({ vectorFeatureNames: drifted }));
  assert.equal(validation.valid, false);
  assert.ok(validation.failures.some((failure) => failure.includes("ordered Phase 6 vector schema")));
});

test("rejects a candidate without immutable fitted parameters", () => {
  const validation = validateProductionCandidate(candidate({ modelArtifact: null }));
  assert.equal(validation.valid, false);
  assert.ok(validation.failures.some((failure) => failure.includes("immutable fitted model artifact")));
});

test("rejects forward-season data and incomplete Phase 6 training cutoffs", () => {
  const validation = validateProductionCandidate(candidate({
    featureVersion: "pregame-v2",
    trainingSeasons: [2021, 2022, 2023, 2024, 2026],
    testSeason: 2026,
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.failures.some((failure) => failure.includes("feature version")));
  assert.ok(validation.failures.some((failure) => failure.includes("2021 through 2025")));
  assert.ok(validation.failures.some((failure) => failure.includes("2025 as the validation cutoff")));
});

test("rejects a historical challenger whose training data reaches its test season", () => {
  const validation = validateProductionCandidate(candidate({
    modelVersion: "phase4-spread-linear_regression-2025-include_low_sample-none-test",
    status: "challenger",
    trainingSeasons: [2021, 2022, 2023, 2024, 2025],
    testSeason: 2025,
    metrics: {},
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.failures.some((failure) => failure.includes("precede the test season")));
});