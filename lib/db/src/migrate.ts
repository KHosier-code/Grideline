import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withExplicitTlsMode } from "./connection";

const { Client } = pg;

const MIGRATION_ENV = "development";
const ADVISORY_LOCK_KEY = "gridline:development:migrations";
const HISTORY_TABLE = "gridline_migration_history";
const MIGRATION_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

export const CRITICAL_HISTORICAL_TABLES = [
  "games",
  "player_game_stats",
  "team_game_stats",
  "pregame_team_features",
  "sportsbook_odds",
  "injuries",
  "prediction_snapshots",
  "model_training_runs",
  "model_evaluation_predictions",
  "model_promotion_history",
  "prediction_grades",
] as const;

export type MigrationStatus = "applied" | "baseline";

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  name: string;
  status: "applied" | "baseline" | "pending" | "already-applied";
  checksum: string;
}

export interface RowCount {
  table: string;
  count: number | null;
}

export interface MigrationRunResult {
  dryRun: boolean;
  historyTableExisted: boolean;
  migrations: MigrationResult[];
  beforeCounts: RowCount[];
  afterCounts: RowCount[];
}

interface MigrationRequirements {
  tables: Set<string>;
  columns: Map<string, Set<string>>;
  indexes: Set<string>;
  triggers: Set<string>;
  constraints: Set<string>;
  validatedConstraints: Set<string>;
  absentIndexes: Set<string>;
  absentConstraints: Set<string>;
}

interface HistoryRow {
  migration_name: string;
  checksum: string;
  status: MigrationStatus;
}

function identifierFromMatch(quoted: string | undefined, bare: string | undefined) {
  return quoted ?? bare;
}

/**
 * A migration is source-controlled executable SQL, so reject dangerous tokens
 * before it can reach a transaction. DROP INDEX is intentionally allowed:
 * migration 0001 removes a known obsolete index before recreating its unique
 * constraint, while DROP TABLE and TRUNCATE are never accepted.
 */
export function assertMigrationSafe(sql: string, migrationName = "migration") {
  if (/\bTRUNCATE\b/i.test(sql)) {
    throw new Error(
      `Migration ${migrationName} rejected: TRUNCATE is not permitted`,
    );
  }
  if (/\bDROP\s+TABLE\b/i.test(sql)) {
    throw new Error(
      `Migration ${migrationName} rejected: DROP TABLE is not permitted`,
    );
  }
}

export function computeChecksum(sql: string) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

export function validateRecordedChecksum(
  migrationName: string,
  expectedChecksum: string,
  recordedChecksum: string,
) {
  if (expectedChecksum !== recordedChecksum) {
    throw new Error(
      `Migration checksum mismatch for ${migrationName}: recorded ${recordedChecksum}, current ${expectedChecksum}`,
    );
  }
}

export function sortMigrations(migrations: MigrationFile[]) {
  return [...migrations].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function readMigrations(): Promise<MigrationFile[]> {
  const entries = await fs.readdir(MIGRATION_DIRECTORY, { withFileTypes: true });
  const migrations = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".sql") &&
          /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name),
      )
      .map(async (entry) => {
        const sql = await fs.readFile(
          path.join(MIGRATION_DIRECTORY, entry.name),
          "utf8",
        );
        assertMigrationSafe(sql, entry.name);
        return {
          name: entry.name,
          sql,
          checksum: computeChecksum(sql),
        };
      }),
  );

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${MIGRATION_DIRECTORY}`);
  }
  return sortMigrations(migrations);
}

export function extractRequirements(sql: string): MigrationRequirements {
  const requirements: MigrationRequirements = {
    tables: new Set(),
    columns: new Map(),
    indexes: new Set(),
    triggers: new Set(),
    constraints: new Set(),
    validatedConstraints: new Set(),
    absentIndexes: new Set(),
    absentConstraints: new Set(),
  };
  const tableName = (quoted: string | undefined, bare: string | undefined) =>
    identifierFromMatch(quoted, bare) as string;

  const createTablePattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of sql.matchAll(createTablePattern)) {
    const name = tableName(match[1], match[2]);
    requirements.tables.add(name);
    const columns = new Set<string>();
    for (const line of match[3].split(/\r?\n/)) {
      const trimmed = line.trim().replace(/,$/, "");
      const quotedColumn = trimmed.match(/^"([^"]+)"\s+/);
      const bareColumn = trimmed.match(/^([a-z_][a-z0-9_]*)\s+/i);
      const column = quotedColumn?.[1] ?? bareColumn?.[1];
      if (
        column &&
        !new Set(["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"]).has(
          column.toUpperCase(),
        )
      ) {
        columns.add(column);
      }
    }
    if (columns.size > 0) requirements.columns.set(name, columns);
  }

  const alterTablePattern =
    /ALTER\s+TABLE\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+([\s\S]*?);/gi;
  for (const match of sql.matchAll(alterTablePattern)) {
    const name = tableName(match[1], match[2]);
    const columns = requirements.columns.get(name) ?? new Set<string>();
    for (const columnMatch of match[3].matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
    )) {
      columns.add(tableName(columnMatch[1], columnMatch[2]));
    }
    if (columns.size > 0) requirements.columns.set(name, columns);
  }

  for (const match of sql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    requirements.indexes.add(tableName(match[1], match[2]));
  }
  for (const match of sql.matchAll(
    /CREATE\s+TRIGGER\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    requirements.triggers.add(tableName(match[1], match[2]));
  }
  for (const match of sql.matchAll(
    /ADD\s+CONSTRAINT\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    requirements.constraints.add(tableName(match[1], match[2]));
  }
  for (const match of sql.matchAll(
    /VALIDATE\s+CONSTRAINT\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    requirements.validatedConstraints.add(tableName(match[1], match[2]));
  }
  for (const match of sql.matchAll(
    /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    requirements.absentIndexes.add(tableName(match[1], match[2]));
  }
  for (const match of sql.matchAll(
    /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    requirements.absentConstraints.add(tableName(match[1], match[2]));
  }
  for (const constraint of requirements.constraints) {
    requirements.absentConstraints.delete(constraint);
    requirements.absentIndexes.delete(constraint);
  }
  return requirements;
}

async function hasTable(client: pg.Client, name: string) {
  const result = await client.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
        AND table_type = 'BASE TABLE'`,
    [name],
  );
  return result.rowCount === 1;
}

async function hasColumn(client: pg.Client, table: string, column: string) {
  const result = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return result.rowCount === 1;
}

async function hasIndex(client: pg.Client, name: string) {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${name}`],
  );
  return result.rows[0]?.exists === true;
}

async function hasConstraint(client: pg.Client, name: string) {
  const result = await client.query(
    "SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname = $1",
    [name],
  );
  return result.rowCount === 1;
}

async function hasValidatedConstraint(client: pg.Client, name: string) {
  const result = await client.query(
    `SELECT 1
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname = $1
        AND convalidated`,
    [name],
  );
  return result.rowCount === 1;
}

async function hasTrigger(client: pg.Client, name: string) {
  const result = await client.query(
    `SELECT 1
       FROM pg_trigger
      WHERE tgname = $1
        AND NOT tgisinternal`,
    [name],
  );
  return result.rowCount === 1;
}

async function verifyExistingSchema(client: pg.Client, sql: string) {
  const requirements = extractRequirements(sql);
  for (const table of requirements.tables) {
    if (!(await hasTable(client, table))) return false;
  }
  for (const [table, columns] of requirements.columns) {
    for (const column of columns) {
      if (!(await hasColumn(client, table, column))) return false;
    }
  }
  for (const index of requirements.indexes) {
    if (!(await hasIndex(client, index))) return false;
  }
  for (const trigger of requirements.triggers) {
    if (!(await hasTrigger(client, trigger))) return false;
  }
  for (const constraint of requirements.constraints) {
    if (!(await hasConstraint(client, constraint))) return false;
  }
  for (const constraint of requirements.validatedConstraints) {
    if (!(await hasValidatedConstraint(client, constraint))) return false;
  }
  for (const index of requirements.absentIndexes) {
    if (await hasIndex(client, index)) return false;
  }
  for (const constraint of requirements.absentConstraints) {
    if (await hasConstraint(client, constraint)) return false;
  }
  return true;
}

async function readHistory(client: pg.Client) {
  const result = await client.query<HistoryRow>(
    `SELECT migration_name, checksum, status
       FROM ${HISTORY_TABLE}
      ORDER BY migration_name`,
  );
  return result.rows;
}

async function ensureHistoryTable(client: pg.Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
      migration_name text PRIMARY KEY,
      checksum text NOT NULL,
      status text NOT NULL CHECK (status IN ('applied', 'baseline')),
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL DEFAULT 0,
      verification text NOT NULL DEFAULT ''
    )
  `);
}

async function transaction(
  client: pg.Client,
  callback: () => Promise<void>,
  rollback = false,
) {
  await client.query("BEGIN");
  try {
    await callback();
    if (rollback) await client.query("ROLLBACK");
    else await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function readCriticalRowCounts(client: pg.Client) {
  const counts: RowCount[] = [];
  for (const table of CRITICAL_HISTORICAL_TABLES) {
    const exists = await hasTable(client, table);
    if (!exists) {
      counts.push({ table, count: null });
      continue;
    }
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${table}"`,
    );
    counts.push({ table, count: Number(result.rows[0]?.count ?? 0) });
  }
  return counts;
}

export function formatDryRunReport(result: MigrationRunResult) {
  const migrationLines = result.migrations
    .map((migration) => `| ${migration.name} | ${migration.status} | \`${migration.checksum}\` |`)
    .join("\n");
  const countLines = result.beforeCounts
    .map((before) => {
      const after = result.afterCounts.find((row) => row.table === before.table);
      return `| ${before.table} | ${before.count ?? "NOT_PRESENT"} | ${after?.count ?? "NOT_PRESENT"} |`;
    })
    .join("\n");
  return `# Development migration dry run

This report was generated by the deterministic development migration runner in
dry-run mode. No migration transaction or ledger row was committed.

## Migration plan

| Migration | Result | SHA-256 |
| --- | --- | --- |
${migrationLines}

## Critical historical row counts

| Table | Before | After |
| --- | ---: | ---: |
${countLines}

All count queries ran against the development database. Production backups,
checkpoints, and schema application are owned by Replit Publish; this runner
must never issue custom DDL against production.
`;
}

export async function runMigrations(options: {
  dryRun?: boolean;
  databaseUrl?: string;
} = {}): Promise<MigrationRunResult> {
  if (process.env.GRIDLINE_MIGRATION_ENV !== MIGRATION_ENV) {
    throw new Error(
      "Refusing to run migrations: set GRIDLINE_MIGRATION_ENV=development. Production schema changes belong to Replit Publish.",
    );
  }
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const dryRun = options.dryRun === true;
  const migrations = await readMigrations();
  const client = new Client({
    connectionString: withExplicitTlsMode(databaseUrl),
  });
  await client.connect();
  let lockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      ADVISORY_LOCK_KEY,
    ]);
    lockHeld = true;
    const beforeCounts = await readCriticalRowCounts(client);
    const historyExistsResult = await client.query<{ exists: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS exists",
      [`public.${HISTORY_TABLE}`],
    );
    const historyTableExisted = historyExistsResult.rows[0]?.exists === true;

    if (!dryRun) {
      await transaction(client, () => ensureHistoryTable(client));
    }
    const history = historyTableExisted ? await readHistory(client) : [];
    const byName = new Map(history.map((row) => [row.migration_name, row]));
    const migrationNames = new Set(migrations.map((migration) => migration.name));
    for (const row of history) {
      if (!migrationNames.has(row.migration_name)) {
        throw new Error(
          `Migration ledger contains unknown migration ${row.migration_name}; refusing to continue`,
        );
      }
      const migration = migrations.find((item) => item.name === row.migration_name);
      validateRecordedChecksum(
        row.migration_name,
        migration!.checksum,
        row.checksum,
      );
      if (row.status !== "applied" && row.status !== "baseline") {
        throw new Error(
          `Migration ledger has invalid status for ${row.migration_name}`,
        );
      }
    }

    const results: MigrationResult[] = [];
    for (const migration of migrations) {
      const recorded = byName.get(migration.name);
      if (recorded) {
        results.push({
          name: migration.name,
          status: "already-applied",
          checksum: migration.checksum,
        });
        continue;
      }

      const baseline = await verifyExistingSchema(client, migration.sql);
      if (baseline) {
        if (!dryRun) {
          await transaction(client, () =>
            client.query(
              `INSERT INTO ${HISTORY_TABLE}
                (migration_name, checksum, status, execution_ms, verification)
               VALUES ($1, $2, 'baseline', 0, $3)`,
              [
                migration.name,
                migration.checksum,
                "Verified existing development schema before ledger bootstrap",
              ],
            ).then(() => undefined),
          );
        }
        results.push({
          name: migration.name,
          status: "baseline",
          checksum: migration.checksum,
        });
        continue;
      }

      if (dryRun) {
        // A dry run validates execution in isolation and deliberately rolls it
        // back. Actual application always uses one committed transaction per
        // migration, including its ledger row.
        await transaction(client, () => client.query(migration.sql).then(() => undefined), true);
        results.push({
          name: migration.name,
          status: "pending",
          checksum: migration.checksum,
        });
      } else {
        const started = Date.now();
        await transaction(client, async () => {
          await client.query(migration.sql);
          await client.query(
            `INSERT INTO ${HISTORY_TABLE}
              (migration_name, checksum, status, execution_ms, verification)
             VALUES ($1, $2, 'applied', $3, $4)`,
            [
              migration.name,
              migration.checksum,
              Math.max(0, Date.now() - started),
              "Migration SQL executed by the development runner",
            ],
          );
        });
        results.push({
          name: migration.name,
          status: "applied",
          checksum: migration.checksum,
        });
      }
    }

    const afterCounts = await readCriticalRowCounts(client);
    return {
      dryRun,
      historyTableExisted,
      migrations: results,
      beforeCounts,
      afterCounts,
    };
  } finally {
    if (lockHeld) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
        ADVISORY_LOCK_KEY,
      ]);
    }
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let reportPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--report") {
      reportPath = args[++index];
      if (!reportPath) throw new Error("--report requires a path");
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  if (reportPath && !dryRun) {
    throw new Error("--report is only valid with --dry-run");
  }
  const result = await runMigrations({ dryRun });
  if (reportPath) {
    await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
    await fs.writeFile(reportPath, formatDryRunReport(result), "utf8");
  }
  for (const migration of result.migrations) {
    console.log(`${migration.name}: ${migration.status}`);
  }
  if (dryRun) console.log("Development migration dry run completed; no changes committed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(
      `Migration runner failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}