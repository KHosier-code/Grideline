import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactIdentityFor,
  fittedArtifactChecksum,
  historicalQbConfidenceForTraining,
  PHASE6_VECTOR_FEATURE_NAMES,
  PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  predictPersistedModelArtifact,
  type FittedModelArtifact,
  verifyArtifactIntegrity,
} from "./modeling";

const artifact: FittedModelArtifact = {
  version: 1,
  algorithm: "linear_regression",
  centers: Array(27).fill(0),
  scales: Array(27).fill(1),
  model: { kind: "linear", coefficients: Array(28).fill(0) },
};
const metadata = artifactIdentityFor(artifact, {
  family: "spread",
  algorithm: "linear_regression",
  featureVersion: "pregame-v3",
  vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
  vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  trainingSeasons: [2021, 2022, 2023, 2024, 2025],
  trainingCutoff: "through-2025",
  samplePolicy: "include_low_sample",
  hyperparameters: { ridgeLambda: 1 },
  randomSeed: null,
  trainingSampleCount: 100,
});
artifact.metadata = metadata;

function run(modelArtifact: FittedModelArtifact = artifact) {
  return { modelArtifact };
}

test("canonical artifact checksum verifies and detects tampering", () => {
  assert.equal(verifyArtifactIntegrity(run()).valid, true);
  const tampered = structuredClone(artifact);
  (tampered.model as { coefficients: number[] }).coefficients[1] = 4;
  assert.equal(verifyArtifactIntegrity(run(tampered)).valid, false);
  assert.notEqual(fittedArtifactChecksum(tampered), metadata.artifactChecksum);
  const metadataTampered = structuredClone(artifact);
  if (!metadataTampered.metadata) assert.fail("expected artifact metadata");
  metadataTampered.metadata.hyperparameters = { ridgeLambda: 999 };
  assert.equal(verifyArtifactIntegrity(run(metadataTampered)).valid, false);
});

test("independent artifact inference is deterministic", () => {
  const row = Array.from({ length: 27 }, (_, index) => index / 10);
  assert.equal(predictPersistedModelArtifact(run(), row), predictPersistedModelArtifact(run(), row));
});

test("artifact inference fails closed for width, missing, and non-finite inputs", () => {
  const row = Array(27).fill(1);
  assert.equal(predictPersistedModelArtifact(run(), row.slice(0, -1)), null);
  assert.equal(predictPersistedModelArtifact(run(), [...row, 1]), null);
  assert.equal(predictPersistedModelArtifact(run(), row.map((value, index) => index === 4 ? Number.NaN : value)), null);
  assert.equal(predictPersistedModelArtifact({ modelArtifact: { ...artifact, metadata: { ...metadata, artifactChecksum: "tampered" } } }, row), null);
});

test("historical QB confidence uses only strictly prior primary-QB games", () => {
  const kickoff = new Date("2025-09-20T17:00:00Z");
  const history = [
    { gameId: "prior-1", kickoffTime: new Date("2025-09-01T17:00:00Z"), primary: true },
    { gameId: "prior-2", kickoffTime: new Date("2025-09-08T17:00:00Z"), primary: true },
    { gameId: "same-time", kickoffTime: kickoff, primary: true },
    { gameId: "future", kickoffTime: new Date("2025-09-21T17:00:00Z"), primary: true },
  ];
  assert.equal(historicalQbConfidenceForTraining(history, kickoff), 0.5);
  assert.equal(historicalQbConfidenceForTraining([
    ...history,
    { gameId: "prior-3", kickoffTime: new Date("2025-09-15T17:00:00Z"), primary: true },
  ], kickoff), 1);
  assert.equal(historicalQbConfidenceForTraining([], kickoff), null);
});
