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
  missingGuard?: string;
  unexpectedGuardError?: string;
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
      if (text.includes("INSERT INTO model_training_runs")) return { rows: [{ id: 73 }] };
      if (text.includes("INSERT INTO model_evaluation_predictions")) return { rows: [{ id: 74 }] };
      if (text.includes("INSERT INTO market_baseline_runs")) return { rows: [{ id: 75 }] };
      if (text.includes("INSERT INTO market_baseline_events")) return { rows: [{ id: 76 }] };
      if (text.includes("INSERT INTO market_baseline_quotes")) return { rows: [{ id: 77 }] };
      if (text.includes("INSERT INTO weather_forecast_snapshots")) return { rows: [{ id: 78 }] };
      const expectedMessages: Record<string, string> = {
        snapshot_update_guard: "official prediction snapshots are immutable",
        snapshot_delete_guard: "official prediction snapshots are immutable",
        grade_update_guard: "prediction grades are immutable",
        grade_delete_guard: "prediction grades are immutable",
        training_run_update_guard: "checksum-backed model training runs are fully immutable",
        training_run_delete_guard: "artifact-backed model training runs are immutable",
        evaluation_update_guard: "model evaluation prediction evidence is immutable",
        evaluation_delete_guard: "model evaluation prediction evidence is immutable",
        market_run_update_guard: "market baseline evidence is append-only",
        market_run_delete_guard: "market baseline evidence is append-only",
        market_event_update_guard: "market baseline evidence is append-only",
        market_event_delete_guard: "market baseline evidence is append-only",
        market_quote_update_guard: "market baseline evidence is append-only",
        market_quote_delete_guard: "market baseline evidence is append-only",
        weather_update_guard: "weather forecast snapshots are append-only",
        weather_delete_guard: "weather forecast snapshots are append-only",
      };
      const isMutation = text.startsWith("UPDATE ") || text.startsWith("DELETE FROM ");
      if (
        isMutation
        && expectedMessages[activeSavepoint]
        && activeSavepoint !== options.missingGuard
      ) {
        transactionAborted = true;
        throw new Error(
          activeSavepoint === options.unexpectedGuardError
            ? "permission denied"
            : expectedMessages[activeSavepoint],
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

test("proves immutable model and evidence update/delete guards and rolls back all probes", async () => {
  const { pool, queries } = immutableGuardPool();
  await verifyImmutablePredictionGuards(pool, "build-123");
  assert.deepEqual(queries.slice(-2), ["ROLLBACK", "RELEASE CLIENT"]);
});

test("fails closed when an immutable prediction guard is absent", async () => {
  for (const missingGuard of [
    "snapshot_update_guard",
    "snapshot_delete_guard",
    "grade_update_guard",
    "grade_delete_guard",
    "training_run_update_guard",
    "training_run_delete_guard",
    "evaluation_update_guard",
    "evaluation_delete_guard",
    "market_run_update_guard",
    "market_run_delete_guard",
    "market_event_update_guard",
    "market_event_delete_guard",
    "market_quote_update_guard",
    "market_quote_delete_guard",
    "weather_update_guard",
    "weather_delete_guard",
  ]) {
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
