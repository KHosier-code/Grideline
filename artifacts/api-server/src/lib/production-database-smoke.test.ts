import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoPostgresTlsCompatibilityWarnings,
  isPostgresTlsCompatibilityWarning,
  recordReleaseSecurityEvidence,
  runProductionDatabaseSmokeCheck,
  verifyProductionDatabaseWithPool,
  verifyImmutablePredictionGuards,
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
            connectivity_passed: true,
            tls_passed: true,
            snapshot_update_guard_passed: true,
            snapshot_delete_guard_passed: true,
            grade_update_guard_passed: true,
            grade_delete_guard_passed: true,
          }],
        };
      },
    },
    "abc123-2026-09-15T12:00:00.000Z",
    1,
  );

  assert.deepEqual(values, ["abc123-2026-09-15T12:00:00.000Z", 1]);
  assert.doesNotMatch(query, /database_url|hostname|username|password|credential/i);
  assert.doesNotMatch(query, /snapshot_label|feature_version|training_cutoff|actual_home_score|actual_away_score|error/i);
  assert.deepEqual(evidence, {
    buildId: "abc123-2026-09-15T12:00:00.000Z",
    checkedAt,
    selectOneResult: 1,
    verifyFullPassed: true,
    connectivityPassed: true,
    tlsPassed: true,
    snapshotUpdateGuardPassed: true,
    snapshotDeleteGuardPassed: true,
    gradeUpdateGuardPassed: true,
    gradeDeleteGuardPassed: true,
  });
  assert.deepEqual(Object.keys(evidence), [
    "buildId",
    "checkedAt",
    "selectOneResult",
    "verifyFullPassed",
    "connectivityPassed",
    "tlsPassed",
    "snapshotUpdateGuardPassed",
    "snapshotDeleteGuardPassed",
    "gradeUpdateGuardPassed",
    "gradeDeleteGuardPassed",
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

function immutableGuardPool(options: {
  missingGuard?: "snapshot_update_guard" | "snapshot_delete_guard" | "grade_update_guard" | "grade_delete_guard";
  unexpectedGuardError?: "snapshot_update_guard" | "snapshot_delete_guard" | "grade_update_guard" | "grade_delete_guard";
} = {}) {
  const queries: string[] = [];
  let activeSavepoint = "";
  let transactionAborted = false;
  const client = {
    async query(text: string) {
      queries.push(text);
      if (transactionAborted && !text.startsWith("ROLLBACK TO SAVEPOINT") && text !== "ROLLBACK") {
        throw new Error("current transaction is aborted");
      }
      if (text.startsWith("SAVEPOINT ")) {
        activeSavepoint = text.slice("SAVEPOINT ".length);
        return { rows: [] };
      }
      if (text.startsWith("ROLLBACK TO SAVEPOINT")) {
        transactionAborted = false;
        return { rows: [] };
      }
      if (text.includes("INSERT INTO prediction_snapshots")) return { rows: [{ id: 71 }] };
      if (text.includes("INSERT INTO prediction_grades")) return { rows: [{ id: 72 }] };
      if (
        (text.startsWith("UPDATE prediction_snapshots") || text.startsWith("DELETE FROM prediction_snapshots"))
        && activeSavepoint !== options.missingGuard
      ) {
        transactionAborted = true;
        throw new Error(
          activeSavepoint === options.unexpectedGuardError
            ? "permission denied"
            : "official prediction snapshots are immutable",
        );
      }
      if (
        (text.startsWith("UPDATE prediction_grades") || text.startsWith("DELETE FROM prediction_grades"))
        && activeSavepoint !== options.missingGuard
      ) {
        transactionAborted = true;
        throw new Error(
          activeSavepoint === options.unexpectedGuardError
            ? "permission denied"
            : "prediction grades are immutable",
        );
      }
      return { rows: [], rowCount: 1 };
    },
    release() {
      queries.push("RELEASE CLIENT");
    },
  };
  return {
    queries,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test("proves snapshot and grade update/delete guards and rolls back all probes", async () => {
  const { pool, queries } = immutableGuardPool();
  await verifyImmutablePredictionGuards(pool, "build-123");

  assert.equal(queries[0], "BEGIN");
  assert.ok(queries.some((query) => query.startsWith("UPDATE prediction_snapshots")));
  assert.ok(queries.some((query) => query.startsWith("DELETE FROM prediction_snapshots")));
  assert.ok(queries.some((query) => query.startsWith("UPDATE prediction_grades")));
  assert.ok(queries.some((query) => query.startsWith("DELETE FROM prediction_grades")));
  assert.deepEqual(queries.slice(-2), ["ROLLBACK", "RELEASE CLIENT"]);
});

test("fails closed and rolls back when any immutable prediction guard is absent", async () => {
  for (const missingGuard of [
    "snapshot_update_guard",
    "snapshot_delete_guard",
    "grade_update_guard",
    "grade_delete_guard",
  ] as const) {
    const { pool, queries } = immutableGuardPool({ missingGuard });
    await assert.rejects(
      verifyImmutablePredictionGuards(pool, "build-123"),
      new RegExp(`absent or ineffective for ${missingGuard}`),
    );
    assert.deepEqual(queries.slice(-2), ["ROLLBACK", "RELEASE CLIENT"]);
  }
});

test("fails closed when an immutable prediction guard returns an unexpected error", async () => {
  const { pool, queries } = immutableGuardPool({ unexpectedGuardError: "grade_update_guard" });
  await assert.rejects(
    verifyImmutablePredictionGuards(pool, "build-123"),
    /unexpected error for grade_update_guard/,
  );
  assert.deepEqual(queries.slice(-2), ["ROLLBACK", "RELEASE CLIENT"]);
});

test("writes no release evidence unless every required guard passes", async () => {
  const { pool: guardPool } = immutableGuardPool({ missingGuard: "grade_delete_guard" });
  let evidenceWrites = 0;
  const pool = {
    ...guardPool,
    async query(text: string) {
      if (text.includes("INSERT INTO release_security_evidence")) evidenceWrites += 1;
      return { rows: [{ connection_check: 1 }] };
    },
  };

  await assert.rejects(
    verifyProductionDatabaseWithPool(pool, "build-123", []),
    /absent or ineffective for grade_delete_guard/,
  );
  assert.equal(evidenceWrites, 0);
});