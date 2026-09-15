import assert from "node:assert/strict";
import test from "node:test";
import { PHASE61_RELEASE_CANDIDATES } from "../release-assets/phase61-release-candidates";
import {
  assertExistingCandidateMatchesRelease,
  releaseCandidateToInsert,
  validatePhase61ReleaseCandidate,
  verifyPersistedPhase61ReleaseCandidates,
} from "./phase61-release";
import {
  assertModelFittingAllowed,
  assertTrainingRunMutationAllowed,
} from "./model-runtime-policy";
import { shouldPersistPregameGame } from "./features";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("approved Phase 6.1 release candidates verify without refitting", () => {
  for (const source of PHASE61_RELEASE_CANDIDATES) {
    const run = releaseCandidateToInsert(source);
    const result = validatePhase61ReleaseCandidate(run);
    assert.equal(result.valid, true, result.failures.join("; "));
    assert.equal(run.vectorFeatureNames?.length, 27);
    assert.ok(Number.isFinite(result.deterministicProbe));
  }
});

test("release verification rejects checksum and feature-order drift", () => {
  const checksumDrift = releaseCandidateToInsert(PHASE61_RELEASE_CANDIDATES[0]);
  checksumDrift.modelArtifact = {
    ...(checksumDrift.modelArtifact ?? {}),
    metadata: {
      ...((checksumDrift.modelArtifact as any).metadata ?? {}),
      artifactChecksum: "0".repeat(64),
    },
  };
  assert.equal(validatePhase61ReleaseCandidate(checksumDrift).valid, false);

  const orderDrift = releaseCandidateToInsert(PHASE61_RELEASE_CANDIDATES[0]);
  orderDrift.vectorFeatureNames = [...(orderDrift.vectorFeatureNames ?? [])].reverse();
  assert.equal(validatePhase61ReleaseCandidate(orderDrift).valid, false);
});

test("idempotent existing rows must match the exact approved payload", () => {
  const run = releaseCandidateToInsert(PHASE61_RELEASE_CANDIDATES[0]);
  assert.doesNotThrow(() => assertExistingCandidateMatchesRelease({ id: 1, ...run } as any, run));
  assert.throws(
    () => assertExistingCandidateMatchesRelease({ id: 1, ...run, notes: "changed" } as any, run),
    /conflicting content/,
  );
});

test("release status rejects self-consistent content under an approved model version", () => {
  const rows = PHASE61_RELEASE_CANDIDATES.map((source, index) => ({
    id: index + 1,
    ...releaseCandidateToInsert(source),
  })) as any[];
  assert.equal(verifyPersistedPhase61ReleaseCandidates(rows).every((item) => item.exactVerified), true);
  rows[0] = { ...rows[0], notes: "conflicting but otherwise self-consistent content" };
  assert.equal(verifyPersistedPhase61ReleaseCandidates(rows)[0].exactVerified, false);
});

test("production blocks fitting and training-run updates", () => {
  assert.throws(() => assertModelFittingAllowed("Refit", "production"), /disabled outside/);
  assert.throws(() => assertTrainingRunMutationAllowed("Update", "production"), /append-only/);
  assert.throws(() => assertModelFittingAllowed("Refit", undefined), /disabled outside/);
  assert.doesNotThrow(() => assertModelFittingAllowed("Refit", "development"));
});

test("worker-owned repair never persists a row at or after kickoff", () => {
  const generatedAt = new Date("2026-09-20T17:00:00.000Z");
  assert.equal(shouldPersistPregameGame(new Date("2026-09-20T17:00:00.001Z"), generatedAt, true), true);
  assert.equal(shouldPersistPregameGame(new Date("2026-09-20T17:00:00.000Z"), generatedAt, true), false);
  assert.equal(shouldPersistPregameGame(new Date("2026-09-20T16:59:59.999Z"), generatedAt, true), false);
});

test("application source has no model-training-run update or delete path", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(root);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /\.update\(\s*modelTrainingRunsTable\s*\)/);
  assert.doesNotMatch(source, /\.delete\(\s*modelTrainingRunsTable\s*\)/);
});

test("routine worker and admin feature rebuilds are explicitly future-only", () => {
  const scheduler = readFileSync(fileURLToPath(new URL("./scheduler.ts", import.meta.url)), "utf8");
  const featureRoute = readFileSync(fileURLToPath(new URL("../routes/features.ts", import.meta.url)), "utf8");
  assert.match(scheduler, /rebuildPregameFeatures\(undefined, new Date\(\), \{ futureOnly: true \}\)/);
  assert.match(featureRoute, /rebuildPregameFeatures\(version \|\| undefined, new Date\(\), \{ futureOnly: true \}\)/);
});

test("future-only filtering does not skip completed games before history accumulation", () => {
  const features = readFileSync(fileURLToPath(new URL("./features.ts", import.meta.url)), "utf8");
  assert.match(features, /const persistTarget = shouldPersistPregameGame/);
  assert.doesNotMatch(features, /if \(!shouldPersistPregameGame\([^)]*\)\) continue/);
  assert.match(features, /if \(persistTarget\) \{[\s\S]*?rows\.push/);
  assert.match(features, /const source = statsByGameTeam\.get/);
});