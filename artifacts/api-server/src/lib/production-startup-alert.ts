export type ProductionDatabaseFailureCategory =
  | "configuration_missing"
  | "tls_policy_unsafe"
  | "tls_compatibility_warning"
  | "smoke_query_failed"
  | "schema_not_ready"
  | "database_connection_failed";

type ErrorWithCode = Error & { code?: unknown };

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "28P01",
  "3D000",
  "57P01",
]);

export function classifyProductionDatabaseFailure(
  error: unknown,
): ProductionDatabaseFailureCategory {
  if (!(error instanceof Error)) return "database_connection_failed";

  if (error.message === "Production database configuration is missing") {
    return "configuration_missing";
  }
  if (error.message === "Production database TLS is not enabled") {
    return "tls_policy_unsafe";
  }
  if (error.message === "PostgreSQL TLS compatibility warning detected") {
    return "tls_compatibility_warning";
  }
  if (
    error.message ===
    "Production database smoke query returned an unexpected result"
  ) {
    return "smoke_query_failed";
  }
  if (error.message.startsWith("Production red-zone schema is not ready:")) {
    return "schema_not_ready";
  }

  const code = (error as ErrorWithCode).code;
  if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) {
    return "database_connection_failed";
  }
  return "database_connection_failed";
}

/**
 * The underlying error's code and a scrubbed message ("password authentication
 * failed for user [name]", "getaddrinfo ENOTFOUND [host]"), so an operator can
 * see why startup failed. Connection strings, quoted names, host names and IP
 * addresses are removed.
 */
export function describeDatabaseFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? (error as ErrorWithCode).code : undefined;
  const message = raw
    .replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]")
    .replace(/"[^"]*"|'[^']*'/g, "[name]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[host]")
    .replace(/\b[\w-]+(\.[\w-]+)+\b/g, "[host]")
    .slice(0, 300);
  return { errorCode: typeof code === "string" ? code : null, errorMessage: message };
}

export function createProductionDatabaseAlert(error: unknown) {
  return {
    event: "production_database_startup_gate_failed",
    severity: "critical",
    service: "gridline",
    failureCategory: classifyProductionDatabaseFailure(error),
    ...describeDatabaseFailure(error),
    deployment: process.env.REPL_ID ?? "current-production-deployment",
    monitoringChannel: "replit_app_monitoring_email",
    action: "api_and_worker_not_started",
  } as const;
}