type QueryablePool = {
  query: (text: string) => Promise<{ rows: unknown[] }>;
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
): Promise<void> {
  const result = await pool.query("SELECT 1 AS connection_check");
  if (result.rows.length !== 1) {
    throw new Error("Production database smoke query returned an unexpected result");
  }
}

export async function verifyProductionDatabase(): Promise<void> {
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
    await runProductionDatabaseSmokeCheck(pool);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assertNoPostgresTlsCompatibilityWarnings(tlsWarnings);
  } finally {
    process.off("warning", onWarning);
    console.warn = originalWarn;
    if (pool) await (pool as typeof import("@workspace/db").pool).end();
  }
}