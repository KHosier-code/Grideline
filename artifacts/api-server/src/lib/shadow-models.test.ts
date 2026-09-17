import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SHADOW_MINIMUM_SAMPLE,
  SHADOW_MODEL_CONTRACT,
  SHADOW_MODEL_FAMILIES,
  shadowFingerprint,
  isAdvancedFeatureRowCutoffSafe,
  selectedReturn,
  settle,
} from "./shadow-models";
import {
  assertBaselineReproducible,
  baselineManifestChecksum,
  diagnoseRetainedBaseline,
  type BaselineManifestPayload,
} from "./shadow-baseline-manifest";

test("shadow contract fixes one cutoff and all four model families", () => {
  assert.equal(SHADOW_MODEL_CONTRACT.cutoffMinutes, 30);
  assert.deepEqual(SHADOW_MODEL_FAMILIES, ["phase61", "advanced_football", "market_residual", "ensemble"]);
  assert.equal(SHADOW_MINIMUM_SAMPLE, 30);
});

test("shadow fingerprints are stable across object insertion order", () => {
  assert.equal(
    shadowFingerprint({ z: [2, 1], a: { y: 2, x: 1 } }),
    shadowFingerprint({ a: { x: 1, y: 2 }, z: [2, 1] }),
  );
});

test("advanced retry rejects feature rows regenerated after the canonical cutoff", () => {
  const cutoff = new Date("2026-09-17T23:45:00.000Z");
  assert.equal(isAdvancedFeatureRowCutoffSafe({
    sourceCutoff: new Date("2026-09-17T23:30:00.000Z"),
    generatedAt: new Date("2026-09-17T23:40:00.000Z"),
  }, cutoff), true);
  assert.equal(isAdvancedFeatureRowCutoffSafe({
    sourceCutoff: new Date("2025-09-01T00:00:00.000Z"),
    generatedAt: new Date("2026-09-17T23:46:00.000Z"),
  }, cutoff), false);
});

function manifest(): BaselineManifestPayload {
  return {
    manifestVersion: "v1",
    sourceUri: "https://example.test/source",
    sourceChecksum: "source",
    parserVersion: "parser",
    filterVersion: "filter",
    evaluationVersion: "evaluation",
    eligibleGameIds: ["a"],
    retainedPredictionIds: ["p"],
    marketEventIds: ["m"],
  };
}

test("baseline manifest fails closed on any identity drift", () => {
  const expected = manifest();
  assert.equal(baselineManifestChecksum(expected), baselineManifestChecksum({ ...expected }));
  assert.doesNotThrow(() => assertBaselineReproducible(expected, { ...expected }));
  assert.throws(
    () => assertBaselineReproducible(expected, { ...expected, eligibleGameIds: ["b"] }),
    /blocked/,
  );
});

test("retained baseline diagnosis keeps missing historical identities permanent", () => {
  const diagnosis = diagnoseRetainedBaseline({
    currentSourceChecksum: "bc87373a5d1a578ac07c71cb6a1e50a381d58fae393021b96853a4b8674ae8b8",
    eligibleGameIds: [],
    retainedPredictionIds: [],
    marketEventIds: [],
  });
  assert.equal(diagnosis.status, "irrecoverable_historical_limitation");
  assert.match(diagnosis.dimensions.missingRows, /did_not_retain/);
});

test("shared settlement and price return rules handle wins, pushes, and missing evidence", () => {
  assert.equal(settle(4, -3, "positive"), "win");
  assert.equal(settle(3, -3, "positive"), "push");
  assert.equal(settle(2, -3, "positive"), "loss");
  // The serialized market snapshot stores the home line (-3) even when the
  // model selects away +3. A two-point home win is therefore an away cover.
  assert.equal(settle(2, -3, "negative"), "win");
  assert.equal(settle(3, -3, "negative"), "push");
  assert.equal(settle(4, -3, "negative"), "loss");
  assert.equal(selectedReturn(settle(2, -3, "negative"), -110), 100 / 110);
  assert.equal(selectedReturn("win", -110), 100 / 110);
  assert.equal(selectedReturn("loss", 120), -1);
  assert.equal(selectedReturn("push", 120), 0);
  assert.equal(selectedReturn("win", undefined), null);
});

test("shadow SQL enforces one family row, chronology, and append-only evidence", () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const sql = [
    readFileSync(path.join(repositoryRoot, "lib/db/migrations/0035_immutable_shadow_models.sql"), "utf8"),
    readFileSync(path.join(repositoryRoot, "lib/db/migrations/0036_shadow_inference_chronology.sql"), "utf8"),
    readFileSync(path.join(repositoryRoot, "lib/db/migrations/0037_shadow_grade_tie_support.sql"), "utf8"),
  ].join("\n");
  assert.match(sql, /UNIQUE \(game_id, model_family\)/);
  assert.match(sql, /shadow_model_cutoffs_prediction_chronology_check[\s\S]*cutoff_at < kickoff_time AND prediction_at < kickoff_time/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON shadow_model_cutoffs/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON shadow_model_grades/);
});