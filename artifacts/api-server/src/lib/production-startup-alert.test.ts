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