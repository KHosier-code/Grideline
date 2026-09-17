import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertMigrationSafe,
  computeChecksum,
  extractRequirements,
  sortMigrations,
  validateRecordedChecksum,
} from "./migrate";

test("migration files are ordered by their versioned filename", () => {
  const sorted = sortMigrations([
    { name: "0010_later.sql", sql: "", checksum: "" },
    { name: "0002_second.sql", sql: "", checksum: "" },
    { name: "0001_first.sql", sql: "", checksum: "" },
  ]);
  assert.deepEqual(
    sorted.map((migration) => migration.name),
    ["0001_first.sql", "0002_second.sql", "0010_later.sql"],
  );
});

test("destructive SQL is rejected before execution", () => {
  assert.throws(
    () => assertMigrationSafe("TRUNCATE TABLE historical_games;", "bad.sql"),
    /TRUNCATE is not permitted/,
  );
  assert.throws(
    () => assertMigrationSafe("DROP TABLE IF EXISTS historical_games;", "bad.sql"),
    /DROP TABLE is not permitted/,
  );
});

test("checksums detect modified migration contents", () => {
  const original = computeChecksum("ALTER TABLE games ADD COLUMN note text;");
  const changed = computeChecksum("ALTER TABLE games ADD COLUMN note integer;");
  assert.notEqual(original, changed);
  assert.throws(
    () => validateRecordedChecksum("0001_example.sql", changed, original),
    /checksum mismatch/,
  );
  assert.doesNotThrow(() =>
    validateRecordedChecksum("0001_example.sql", original, original),
  );
});

test("migration requirements include append-only triggers", () => {
  const requirements = extractRequirements(`
    CREATE TABLE IF NOT EXISTS "audit_rows" ("id" integer);
    CREATE TRIGGER "audit_rows_append_only"
      BEFORE UPDATE OR DELETE ON "audit_rows"
      FOR EACH ROW EXECUTE FUNCTION reject_mutation();
  `);
  assert.deepEqual([...requirements.triggers], ["audit_rows_append_only"]);
});

test("migration requirements include validated constraints", () => {
  const requirements = extractRequirements(`
    ALTER TABLE "model_evaluation_predictions"
      VALIDATE CONSTRAINT "model_evaluation_future_identity_check",
      VALIDATE CONSTRAINT model_evaluation_projection_completeness_check;
  `);
  assert.deepEqual(
    [...requirements.validatedConstraints],
    [
      "model_evaluation_future_identity_check",
      "model_evaluation_projection_completeness_check",
    ],
  );
});

test("Sleeper identity mapping migration protects runs and results as append-only", () => {
  const migration = fs.readFileSync(
    new URL("../migrations/0023_sleeper_identity_mapping.sql", import.meta.url),
    "utf8",
  );
  const requirements = extractRequirements(migration);
  assert.deepEqual(
    [...requirements.triggers].sort(),
    [
      "sleeper_identity_mapping_runs_append_only",
      "sleeper_identity_mappings_append_only",
    ],
  );
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "sleeper_identity_mapping_runs"/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "sleeper_identity_mappings"/);
});