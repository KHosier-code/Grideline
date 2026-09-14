import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMigrationSafe,
  computeChecksum,
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