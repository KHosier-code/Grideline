import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRedZoneSchemaReady,
  assertNoPostgresTlsCompatibilityWarnings,
  isPostgresTlsCompatibilityWarning,
  recordReleaseSecurityEvidence,
  runProductionDatabasePreflight,
  runProductionDatabaseSmokeCheck,
} from "./production-database-smoke";
import { startProductionServices, waitForApiHealth } from "./production-startup";

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

const checkedAt = new Date("2026-09-15T12:00:00.000Z");
async function withRedZoneFlag<T>(value: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.GRIDLINE_RED_ZONE_ENABLED;
  if (value === undefined) delete process.env.GRIDLINE_RED_ZONE_ENABLED;
  else process.env.GRIDLINE_RED_ZONE_ENABLED = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.GRIDLINE_RED_ZONE_ENABLED;
    else process.env.GRIDLINE_RED_ZONE_ENABLED = previous;
  }
}

function schemaFixture(
  missing: { object_type: string; object_name: string }[] = [],
  buildId = "build-1",
) {
  const queries: string[] = [];
  return {
    queries,
    async query(text: string) {
      queries.push(text);
      if (text === "SELECT 1 AS connection_check") return { rows: [{ connection_check: 1 }] };
      if (text.includes("pg_catalog.pg_constraint")) return { rows: missing };
      if (text.includes("INSERT INTO release_security_evidence")) {
        return { rows: [{
          build_id: buildId, checked_at: checkedAt,
          select_one_result: 1, verify_full_passed: true,
        }] };
      }
      throw new Error(`Unexpected database operation: ${text}`);
    },
  };
}

test("read-only readiness query checks both tables and their owned, valid constraints and indexes", async () => {
  const fixture = schemaFixture();
  await assertRedZoneSchemaReady(fixture);
  const [query] = fixture.queries;
  assert.match(query, /red_zone_player_game_facts/);
  assert.match(query, /red_zone_team_game_facts/);
  for (const object of [
    "red_zone_player_game_facts_pkey", "red_zone_player_game_zone_check",
    "red_zone_player_game_counts_check", "red_zone_team_game_facts_pkey",
    "red_zone_team_game_zone_check", "red_zone_team_game_counts_check",
    "red_zone_player_game_season_idx", "red_zone_player_game_team_idx",
    "red_zone_team_game_season_idx",
  ]) assert.ok(query.includes(object), `Missing required object ${object}`);
  assert.match(query, /con\.convalidated/);
  assert.match(query, /ix\.indisvalid AND ix\.indisready/);
  assert.match(query, /c\.oid = con\.conrelid/);
  assert.match(query, /ix\.indrelid/);
  assert.doesNotMatch(query, /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i);
});

test("missing table fixture prevents both production processes and release evidence", async () => {
  const fixture = schemaFixture([{ object_type: "table", object_name: "red_zone_team_game_facts" }]);
  const started: string[] = [];
  await withRedZoneFlag("1", () => assert.rejects(
    startProductionServices(
      () => runProductionDatabasePreflight(fixture, "build-1"),
      () => { started.push("worker"); },
      () => { started.push("api"); },
    ),
    /Production red-zone schema is not ready: missing or invalid table red_zone_team_game_facts.*Replit Publish/,
  ));
  assert.deepEqual(started, []);
  assert.equal(fixture.queries.length, 2);
  assert.ok(fixture.queries.every((query) => /^\s*(SELECT|WITH)\b/i.test(query)));
});

test("missing or invalid constraint and index block startup too", async () => {
  await withRedZoneFlag("1", async () => {
    for (const object of [
      { object_type: "constraint", object_name: "red_zone_player_game_zone_check" },
      { object_type: "index", object_name: "red_zone_team_game_season_idx" },
    ]) {
      const fixture = schemaFixture([object]);
      await assert.rejects(
        runProductionDatabasePreflight(fixture, "build-1"),
        new RegExp(`${object.object_type} ${object.object_name}`),
      );
      assert.equal(fixture.queries.length, 2);
    }
  });
});

test("migrated fixture starts API then worker after readiness and evidence", async () => {
  const fixture = schemaFixture();
  const started: string[] = [];
  const evidence = await withRedZoneFlag("1", () => startProductionServices(
    () => runProductionDatabasePreflight(fixture, "build-1"),
    () => { started.push("worker"); },
    () => { started.push("api"); },
  ));
  assert.deepEqual(started, ["api", "worker"]);
  assert.deepEqual(fixture.queries.map((query) =>
    query === "SELECT 1 AS connection_check" ? "connect"
      : query.includes("pg_catalog.pg_constraint") ? "schema" : "evidence",
  ), ["connect", "schema", "evidence"]);
  assert.equal(evidence.buildId, "build-1");
});

test("worker waits for API startup and is not started when API startup fails", async () => {
  const started: string[] = [];
  let releaseApi!: () => void;
  const apiReady = new Promise<void>((resolve) => { releaseApi = resolve; });
  const startup = withRedZoneFlag("1", () => startProductionServices(
    () => runProductionDatabasePreflight(schemaFixture(), "build-2"),
    () => { started.push("worker"); },
    () => { started.push("api"); return apiReady; },
  ));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["api"]);
  releaseApi();
  await startup;
  assert.deepEqual(started, ["api", "worker"]);
  await assert.rejects(withRedZoneFlag("1", () => startProductionServices(
    () => runProductionDatabasePreflight(schemaFixture(), "build-3"),
    () => { started.push("unexpected-worker"); },
    () => { throw new Error("API startup failed"); },
  )), /API startup failed/);
  assert.equal(started.includes("unexpected-worker"), false);
});

test("disabled preflight skips absent red-zone schema while retaining connectivity and release evidence", async () => {
  const fixture = schemaFixture([
    { object_type: "table", object_name: "red_zone_player_game_facts" },
    { object_type: "table", object_name: "red_zone_team_game_facts" },
  ], "build-disabled");
  const started: string[] = [];
  let tlsChecked = false;
  const evidence = await withRedZoneFlag(undefined, () => startProductionServices(
    () => runProductionDatabasePreflight(fixture, "build-disabled", async () => { tlsChecked = true; }),
    () => { started.push("worker"); },
    () => { started.push("api"); },
  ));
  assert.equal(evidence.buildId, "build-disabled");
  assert.deepEqual(started, ["api", "worker"]);
  assert.equal(tlsChecked, true);
  assert.equal(fixture.queries.length, 2);
  assert.equal(fixture.queries[0], "SELECT 1 AS connection_check");
  assert.match(fixture.queries[1]!, /INSERT INTO release_security_evidence/);
});

test("only the exact string 1 enables the red-zone schema readiness check", async () => {
  for (const value of ["", "true", "yes", "01"]) {
    const fixture = schemaFixture([{ object_type: "table", object_name: "red_zone_player_game_facts" }]);
    await withRedZoneFlag(value, () => runProductionDatabasePreflight(fixture, "build-disabled"));
    assert.equal(fixture.queries.length, 2, `flag value ${JSON.stringify(value)} should remain disabled`);
  }
});

test("API must answer its local health check before the worker can start", async () => {
  let attempts = 0;
  await waitForApiHealth("http://127.0.0.1:8080/api/healthz", () => true, async () => {
    attempts += 1;
    return { ok: attempts >= 2 };
  }, 2_000);
  assert.equal(attempts, 2);
  await assert.rejects(
    waitForApiHealth("http://127.0.0.1:8080/api/healthz", () => false, async () => ({ ok: true })),
    /exited before becoming healthy/,
  );
  await assert.rejects(
    waitForApiHealth("http://127.0.0.1:8080/api/healthz", () => true, async () => ({ ok: false }), 5),
    /did not become healthy/,
  );
});