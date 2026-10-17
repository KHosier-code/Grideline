import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProductionDatabaseFailure,
  createProductionDatabaseAlert,
} from "./production-startup-alert";

test("classifies production database startup failures without exposing details", () => {
  assert.equal(
    classifyProductionDatabaseFailure(
      new Error("Production database configuration is missing"),
    ),
    "configuration_missing",
  );
  assert.equal(
    classifyProductionDatabaseFailure(
      new Error("Production database TLS is not enabled"),
    ),
    "tls_policy_unsafe",
  );
  assert.equal(
    classifyProductionDatabaseFailure(
      new Error("PostgreSQL TLS compatibility warning detected"),
    ),
    "tls_compatibility_warning",
  );
  assert.equal(
    classifyProductionDatabaseFailure(
      new Error(
        "Production database smoke query returned an unexpected result",
      ),
    ),
    "smoke_query_failed",
  );
  assert.equal(
    classifyProductionDatabaseFailure(
      new Error("Production red-zone schema is not ready: missing or invalid table red_zone_team_game_facts"),
    ),
    "schema_not_ready",
  );
});

test("alert contains only allow-listed operational metadata", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalReplId = process.env.REPL_ID;
  process.env.DATABASE_URL =
    "postgresql://operator:secret@private.example/database";
  process.env.REPL_ID = "deployment-project-123";

  try {
    const alert = createProductionDatabaseAlert(
      Object.assign(new Error("connect private.example failed"), {
        code: "ECONNREFUSED",
      }),
    );
    assert.deepEqual(alert, {
      event: "production_database_startup_gate_failed",
      severity: "critical",
      service: "gridline",
      failureCategory: "database_connection_failed",
      errorCode: "ECONNREFUSED",
      errorMessage: "connect [host] failed",
      deployment: "deployment-project-123",
      monitoringChannel: "replit_app_monitoring_email",
      action: "api_and_worker_not_started",
    });
    const serialized = JSON.stringify(alert);
    assert.doesNotMatch(serialized, /operator|secret|private\.example/);
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalReplId === undefined) delete process.env.REPL_ID;
    else process.env.REPL_ID = originalReplId;
  }
});
test("database alert keeps the reason but scrubs names, hosts and connection strings", async () => {
  const { describeDatabaseFailure } = await import("./production-startup-alert");
  assert.deepEqual(
    describeDatabaseFailure(Object.assign(new Error('password authentication failed for user "neondb_owner"'), { code: "28P01" })),
    { errorCode: "28P01", errorMessage: "password authentication failed for user [name]" },
  );
  assert.deepEqual(
    describeDatabaseFailure(Object.assign(new Error("getaddrinfo ENOTFOUND ep-x-pooler.c-7.us-east-2.aws.neon.tech"), { code: "ENOTFOUND" })),
    { errorCode: "ENOTFOUND", errorMessage: "getaddrinfo ENOTFOUND [host]" },
  );
  const leaked = describeDatabaseFailure(new Error("bad url postgresql://u:p@h.example/db and 10.0.0.1"));
  assert.doesNotMatch(JSON.stringify(leaked), /u:p|h\.example|10\.0\.0\.1/);
});
