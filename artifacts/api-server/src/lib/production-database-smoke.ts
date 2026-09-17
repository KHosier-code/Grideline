type QueryablePool = {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
};

export type ProductionDatabaseEvidence = {
  buildId: string;
  checkedAt: Date;
  selectOneResult: 1;
  verifyFullPassed: true;
};

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
  pool: QueryablePool,
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
  pool: QueryablePool,
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
    await new Promise<void>((resolve) => setImmediate(resolve));
    assertNoPostgresTlsCompatibilityWarnings(tlsWarnings);
    return await recordReleaseSecurityEvidence(pool, buildId, selectOneResult);
  } finally {
    process.off("warning", onWarning);
    console.warn = originalWarn;
    if (pool) await (pool as typeof import("@workspace/db").pool).end();
  }
}