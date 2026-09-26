import { isRedZoneFeatureEnabled } from "./red-zone-feature-flag";

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

// Names and ownership come from the managed Publish migration. This probe must
// never repair schema: a failed Publish diff must stop both production services.
export async function assertRedZoneSchemaReady(pool: QueryablePool): Promise<void> {
  const result = await pool.query(`
    WITH required_tables(table_name) AS (
      VALUES ('red_zone_player_game_facts'), ('red_zone_team_game_facts')
    ), required_constraints(table_name, object_name, constraint_type) AS (
      VALUES
        ('red_zone_player_game_facts', 'red_zone_player_game_facts_pkey', 'p'),
        ('red_zone_player_game_facts', 'red_zone_player_game_zone_check', 'c'),
        ('red_zone_player_game_facts', 'red_zone_player_game_counts_check', 'c'),
        ('red_zone_team_game_facts', 'red_zone_team_game_facts_pkey', 'p'),
        ('red_zone_team_game_facts', 'red_zone_team_game_zone_check', 'c'),
        ('red_zone_team_game_facts', 'red_zone_team_game_counts_check', 'c')
    ), required_indexes(table_name, object_name) AS (
      VALUES
        ('red_zone_player_game_facts', 'red_zone_player_game_season_idx'),
        ('red_zone_player_game_facts', 'red_zone_player_game_team_idx'),
        ('red_zone_team_game_facts', 'red_zone_team_game_season_idx')
    )
    SELECT 'table' AS object_type, t.table_name AS object_name
    FROM required_tables t
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = t.table_name AND c.relkind IN ('r', 'p')
    )
    UNION ALL
    SELECT 'constraint', k.object_name
    FROM required_constraints k
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = k.table_name
        AND c.relkind IN ('r', 'p')
        AND con.conname = k.object_name AND con.contype = k.constraint_type
        AND con.convalidated
    )
    UNION ALL
    SELECT 'index', i.object_name
    FROM required_indexes i
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class idx
      JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
      JOIN pg_catalog.pg_index ix ON ix.indexrelid = idx.oid
      JOIN pg_catalog.pg_class c ON c.oid = ix.indrelid
      WHERE n.nspname = current_schema() AND c.relnamespace = n.oid
        AND c.relname = i.table_name AND idx.relname = i.object_name
        AND idx.relkind IN ('i', 'I') AND ix.indisvalid AND ix.indisready
    )
    ORDER BY object_type, object_name
  `);
  const missing = result.rows as { object_type: string; object_name: string }[];
  if (missing.length) {
    throw new Error(
      `Production red-zone schema is not ready: missing or invalid ${missing.map(
        ({ object_type, object_name }) => `${object_type} ${object_name}`,
      ).join(", ")}. Apply the managed schema diff through Replit Publish before starting the API and worker.`,
    );
  }
}

export async function runProductionDatabasePreflight(
  pool: QueryablePool,
  buildId: string,
  checkTlsWarnings: () => Promise<void> = async () => {},
): Promise<ProductionDatabaseEvidence> {
  const selectOneResult = await runProductionDatabaseSmokeCheck(pool);
  if (isRedZoneFeatureEnabled()) await assertRedZoneSchemaReady(pool);
  await checkTlsWarnings();
  return recordReleaseSecurityEvidence(pool, buildId, selectOneResult);
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
    return await runProductionDatabasePreflight(pool, buildId, async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assertNoPostgresTlsCompatibilityWarnings(tlsWarnings);
    });
  } finally {
    process.off("warning", onWarning);
    console.warn = originalWarn;
    if (pool) await (pool as typeof import("@workspace/db").pool).end();
  }
}