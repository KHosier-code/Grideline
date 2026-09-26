import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  assertRedZoneSchemaReady,
  runProductionDatabasePreflight,
  runProductionDatabaseSmokeCheck,
} from "./production-database-smoke";
import { startProductionServices } from "./production-startup";

// Opt-in development-only experiment. The schema and all five DDL statements
// live inside one transaction that is rolled back before this test returns.
test("current approved additive diff gates API then worker in an isolated schema", {
  skip: process.env.GRIDLINE_DISPOSABLE_SCHEMA_TEST !== "1",
}, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Disposable schema test can run only in development");
  }
  const diffPath = process.env.GRIDLINE_APPROVED_SCHEMA_DIFF;
  if (!diffPath) throw new Error("Set GRIDLINE_APPROVED_SCHEMA_DIFF to a freshly reviewed Publish diff JSON");
  const statements = JSON.parse(await readFile(resolve(diffPath), "utf8")) as unknown;
  const expected = [
    /^CREATE TABLE "red_zone_player_game_facts" \(/,
    /^CREATE TABLE "red_zone_team_game_facts" \(/,
    /^CREATE INDEX "red_zone_player_game_season_idx" ON "red_zone_player_game_facts"/,
    /^CREATE INDEX "red_zone_player_game_team_idx" ON "red_zone_player_game_facts"/,
    /^CREATE INDEX "red_zone_team_game_season_idx" ON "red_zone_team_game_facts"/,
  ];
  if (!Array.isArray(statements) || statements.length !== expected.length) {
    throw new Error("The reviewed Publish diff must contain exactly five additive statements");
  }
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(typeof statements[i], "string");
    assert.match(statements[i] as string, expected[i]!);
    assert.doesNotMatch(statements[i] as string, /\b(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT)\b/i);
    assert.doesNotMatch(statements[i] as string, /"(?:public|pg_catalog)"\./i);
  }

  const client = await pool.connect();
  let inTransaction = false;
  const schema = `gridline_gate_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const queryable = {
    query: (text: string, values?: readonly unknown[]) => client.query(text, values ? [...values] : undefined),
  };
  const previousFlag = process.env.GRIDLINE_RED_ZONE_ENABLED;
  try {
    const { rows: identities } = await client.query(`
      SELECT current_database() AS database_name, current_user AS database_role,
             pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy
    `);
    const identity = identities[0] as {
      database_name: string; database_role: string; replica: boolean; local_proxy: boolean;
    } | undefined;
    if (identities.length !== 1 || identity?.database_name !== "heliumdb"
      || identity.database_role !== "postgres" || identity.replica || !identity.local_proxy) {
      throw new Error("Refusing disposable schema test on an unverified development database");
    }
    const baseline = await client.query(`
      SELECT (SELECT count(*) FROM public.games) AS games,
             (SELECT count(*) FROM public.red_zone_player_game_facts) AS player_facts
    `);
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    // Test-only stand-in for the already-existing release-evidence table.
    // The approved Publish diff remains the five statements supplied below.
    await client.query(`CREATE TABLE release_security_evidence (
      build_id text PRIMARY KEY, checked_at timestamptz NOT NULL DEFAULT now(),
      select_one_result integer NOT NULL, verify_full_passed boolean NOT NULL
    )`);
    delete process.env.GRIDLINE_RED_ZONE_ENABLED;
    await runProductionDatabasePreflight(queryable, "isolated-disabled-without-schema");
    process.env.GRIDLINE_RED_ZONE_ENABLED = "1";
    await assert.rejects(
      runProductionDatabasePreflight(queryable, "isolated-enabled-without-schema"),
      /schema is not ready/,
    );
    const verify = async () => {
      await runProductionDatabaseSmokeCheck(queryable);
      await assertRedZoneSchemaReady(queryable);
      return { buildId: "isolated-schema-test", checkedAt: new Date(),
        selectOneResult: 1 as const, verifyFullPassed: true as const };
    };
    const started: string[] = [];
    const startWorker = () => { started.push("worker"); };
    const startApi = async () => { started.push("api"); };

    await assert.rejects(startProductionServices(verify, startWorker, startApi), /schema is not ready/);
    assert.deepEqual(started, [], "neither process may start without the migration");

    for (const sql of statements.slice(0, -1) as string[]) await client.query(sql);
    await client.query("SAVEPOINT failed_index");
    await assert.rejects(client.query(`CREATE INDEX "red_zone_team_game_season_idx"
      ON "missing_table" ("season")`));
    await client.query("ROLLBACK TO SAVEPOINT failed_index");
    await assert.rejects(startProductionServices(verify, startWorker, startApi), /index red_zone_team_game_season_idx/);
    assert.deepEqual(started, [], "a failed or incomplete migration must not start either process");

    await client.query(statements.at(-1) as string);
    await runProductionDatabasePreflight(queryable, "isolated-enabled-with-schema");
    await startProductionServices(verify, startWorker, startApi);
    assert.deepEqual(started, ["api", "worker"]);
    await client.query("ROLLBACK");
    inTransaction = false;

    const after = await client.query(`
      SELECT (SELECT count(*) FROM public.games) AS games,
             (SELECT count(*) FROM public.red_zone_player_game_facts) AS player_facts,
             to_regnamespace($1) AS disposable_schema
    `, [schema]);
    assert.equal(after.rows[0]?.games, baseline.rows[0]?.games);
    assert.equal(after.rows[0]?.player_facts, baseline.rows[0]?.player_facts);
    assert.equal(after.rows[0]?.disposable_schema, null);
  } finally {
    if (previousFlag === undefined) delete process.env.GRIDLINE_RED_ZONE_ENABLED;
    else process.env.GRIDLINE_RED_ZONE_ENABLED = previousFlag;
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});