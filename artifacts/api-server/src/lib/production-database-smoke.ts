type QueryablePool = {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<QueryableClient>;
};

type QueryResult = {
  rows: unknown[];
  rowCount?: number | null;
};

type QueryableClient = {
  query: (text: string, values?: readonly unknown[]) => Promise<QueryResult>;
  release: () => void;
};

export type ProductionDatabaseEvidence = {
  buildId: string;
  checkedAt: Date;
  selectOneResult: 1;
  verifyFullPassed: true;
};

const IMMUTABLE_SNAPSHOT_MESSAGE = "official prediction snapshots are immutable";
const IMMUTABLE_GRADE_MESSAGE = "prediction grades are immutable";

async function expectRejectedMutation(
  client: QueryableClient,
  savepoint: string,
  query: string,
  values: readonly unknown[],
  expectedMessage: string,
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(query, values);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    throw new Error(`Immutable prediction guard returned an unexpected error for ${savepoint}`);
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  throw new Error(`Immutable prediction guard is absent or ineffective for ${savepoint}`);
}

/**
 * Proves the managed production database rejects canonical snapshot and grade
 * mutations. Probe rows and all attempted changes are rolled back, so this is
 * startup verification rather than startup schema management.
 */
export async function verifyImmutablePredictionGuards(
  pool: Pick<QueryablePool, "connect">,
  buildId: string,
): Promise<void> {
  const client = await pool.connect();
  const probeKey = `production-immutability-probe:${buildId}`;
  try {
    await client.query("BEGIN");
    const snapshot = await client.query(
      `INSERT INTO prediction_snapshots
         (snapshot_key, game_id, snapshot_label, feature_version, training_cutoff,
          official_final_prediction, frozen_at)
       VALUES ($1, $2, 'production-guard-probe', 'production-guard-probe',
               'production-guard-probe', true, now())
       RETURNING id`,
      [probeKey, probeKey],
    );
    const snapshotId = (snapshot.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof snapshotId !== "number") {
      throw new Error("Immutable prediction guard probe snapshot was not inserted");
    }

    await expectRejectedMutation(
      client,
      "snapshot_update_guard",
      "UPDATE prediction_snapshots SET snapshot_label = $1 WHERE id = $2",
      ["mutation-must-fail", snapshotId],
      IMMUTABLE_SNAPSHOT_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "snapshot_delete_guard",
      "DELETE FROM prediction_snapshots WHERE id = $1",
      [snapshotId],
      IMMUTABLE_SNAPSHOT_MESSAGE,
    );

    const grade = await client.query(
      `INSERT INTO prediction_grades (prediction_id, actual_home_score, actual_away_score)
       VALUES ($1, 0, 0)
       RETURNING id`,
      [snapshotId],
    );
    const gradeId = (grade.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof gradeId !== "number") {
      throw new Error("Immutable prediction guard probe grade was not inserted");
    }
    await expectRejectedMutation(
      client,
      "grade_update_guard",
      "UPDATE prediction_grades SET actual_home_score = 1 WHERE id = $1",
      [gradeId],
      IMMUTABLE_GRADE_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "grade_delete_guard",
      "DELETE FROM prediction_grades WHERE id = $1",
      [gradeId],
      IMMUTABLE_GRADE_MESSAGE,
    );
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

const TLS_WARNING_PATTERNS = [
  /sslmode/i,
  /uselibpqcompat/i,
  /tls compatibility/i,
  /certificate verification/i,
];

export function isPostgresTlsCompatibilityWarning(message: string): boolean {
  return TLS_WARNING_PATTERNS.some((pattern) => pattern.test(message));
}

export function assertNoPostgresTlsCompatibilityWarnings(
  warnings: readonly string[],
): void {
  if (warnings.some(isPostgresTlsCompatibilityWarning)) {
    throw new Error("PostgreSQL TLS compatibility warning detected");
  }
}

export async function runProductionDatabaseSmokeCheck(
  pool: Pick<QueryablePool, "query">,
): Promise<1> {
  const result = await pool.query("SELECT 1 AS connection_check");
  if (
    result.rows.length !== 1 ||
    (result.rows[0] as { connection_check?: unknown }).connection_check !== 1
  ) {
    throw new Error("Production database smoke query returned an unexpected result");
  }
  return 1;
}

export async function recordReleaseSecurityEvidence(
  pool: Pick<QueryablePool, "query">,
  buildId: string,
  selectOneResult: 1,
): Promise<ProductionDatabaseEvidence> {
  const result = await pool.query(
    `INSERT INTO release_security_evidence
       (build_id, select_one_result, verify_full_passed)
     VALUES ($1, $2, true)
     ON CONFLICT (build_id) DO UPDATE
       SET build_id = EXCLUDED.build_id
     RETURNING build_id, checked_at, select_one_result, verify_full_passed`,
    [buildId, selectOneResult],
  );
  const row = result.rows[0] as
    | {
        build_id: string;
        checked_at: Date;
        select_one_result: 1;
        verify_full_passed: true;
      }
    | undefined;
  if (!row) throw new Error("Release security evidence was not recorded");
  return {
    buildId: row.build_id,
    checkedAt: row.checked_at,
    selectOneResult: row.select_one_result,
    verifyFullPassed: row.verify_full_passed,
  };
}

export async function verifyProductionDatabase(
  buildId: string,
): Promise<ProductionDatabaseEvidence> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Production database configuration is missing");
  }

  const configuredMode = new URL(databaseUrl).searchParams.get("sslmode");
  if (!configuredMode || configuredMode === "disable") {
    throw new Error("Production database TLS is not enabled");
  }

  const tlsWarnings: string[] = [];
  const onWarning = (warning: Error) => {
    if (isPostgresTlsCompatibilityWarning(warning.message)) {
      tlsWarnings.push(warning.message);
    }
  };
  const originalWarn = console.warn;
  console.warn = (...arguments_: unknown[]) => {
    const message = arguments_.map(String).join(" ");
    if (isPostgresTlsCompatibilityWarning(message)) tlsWarnings.push(message);
    else originalWarn(...arguments_);
  };
  process.on("warning", onWarning);

  let pool: QueryablePool | undefined;
  try {
    const database = await import("@workspace/db");
    pool = database.pool;
    const selectOneResult = await runProductionDatabaseSmokeCheck(pool);
    await verifyImmutablePredictionGuards(pool, buildId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assertNoPostgresTlsCompatibilityWarnings(tlsWarnings);
    return await recordReleaseSecurityEvidence(pool, buildId, selectOneResult);
  } finally {
    process.off("warning", onWarning);
    console.warn = originalWarn;
    if (pool) await (pool as typeof import("@workspace/db").pool).end();
  }
}