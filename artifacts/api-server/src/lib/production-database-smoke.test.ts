import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoPostgresTlsCompatibilityWarnings,
  isPostgresTlsCompatibilityWarning,
  runProductionDatabaseSmokeCheck,
} from "./production-database-smoke";

test("uses a metadata-free connectivity query", async () => {
  let query = "";
  await runProductionDatabaseSmokeCheck({
    async query(text) {
      query = text;
      return { rows: [{ connection_check: 1 }] };
    },
  });

  assert.equal(query, "SELECT 1 AS connection_check");
  assert.doesNotMatch(query, /information_schema|pg_catalog/i);
});

test("rejects an unexpected smoke-query result", async () => {
  await assert.rejects(
    runProductionDatabaseSmokeCheck({
      async query() {
        return { rows: [] };
      },
    }),
    /unexpected result/,
  );
});

test("recognizes PostgreSQL TLS compatibility warnings", () => {
  assert.equal(
    isPostgresTlsCompatibilityWarning(
      "To use the legacy sslmode behavior, add uselibpqcompat=true",
    ),
    true,
  );
  assert.equal(isPostgresTlsCompatibilityWarning("ordinary application warning"), false);
});

test("fails the smoke check when a PostgreSQL TLS warning was captured", () => {
  assert.throws(
    () =>
      assertNoPostgresTlsCompatibilityWarnings([
        "SECURITY WARNING: sslmode=require uses compatibility behavior",
      ]),
    /TLS compatibility warning detected/,
  );
});