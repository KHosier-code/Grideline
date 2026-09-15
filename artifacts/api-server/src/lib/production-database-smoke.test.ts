import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoPostgresTlsCompatibilityWarnings,
  isPostgresTlsCompatibilityWarning,
  recordReleaseSecurityEvidence,
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

test("records only credential-free release security evidence", async () => {
  const checkedAt = new Date("2026-09-15T12:00:00.000Z");
  let query = "";
  let values: readonly unknown[] | undefined;
  const evidence = await recordReleaseSecurityEvidence(
    {
      async query(text, parameters) {
        query = text;
        values = parameters;
        return {
          rows: [{
            build_id: "abc123-2026-09-15T12:00:00.000Z",
            checked_at: checkedAt,
            select_one_result: 1,
            verify_full_passed: true,
          }],
        };
      },
    },
    "abc123-2026-09-15T12:00:00.000Z",
    1,
  );

  assert.deepEqual(values, ["abc123-2026-09-15T12:00:00.000Z", 1]);
  assert.doesNotMatch(query, /database_url|hostname|username|password|credential/i);
  assert.deepEqual(evidence, {
    buildId: "abc123-2026-09-15T12:00:00.000Z",
    checkedAt,
    selectOneResult: 1,
    verifyFullPassed: true,
  });
  assert.deepEqual(Object.keys(evidence), [
    "buildId",
    "checkedAt",
    "selectOneResult",
    "verifyFullPassed",
  ]);
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