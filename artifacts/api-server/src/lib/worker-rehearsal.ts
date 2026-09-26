/**
 * This module must remain free of database/provider imports: the URL is
 * validated before the pool (or any scheduler dependency) can be loaded.
 */
import { userInfo } from "node:os";
import net from "node:net";
export type WorkerEnvironment = NodeJS.ProcessEnv;
export const rehearsalGuardStats = { deniedSockets: 0, deniedFetches: 0, deniedTimers: 0 };

export function rehearsalRequested(env: WorkerEnvironment) {
  return env.GRIDLINE_WORKER_REHEARSAL === "1";
}

export function assertWorkerStartupConfiguration(env: WorkerEnvironment) {
  if (rehearsalRequested(env)) return assertRehearsalConfiguration(env);
  if (env.GRIDLINE_WORKER_REHEARSAL !== undefined
    || env.GRIDLINE_REHEARSAL_NO_PROVIDERS !== undefined
    || env.GRIDLINE_REHEARSAL_NO_SCHEDULED_EXECUTION !== undefined
    || env.GRIDLINE_REHEARSAL_NO_RETENTION !== undefined
    || env.GRIDLINE_REHEARSAL_MARKER !== undefined
    || env.GRIDLINE_REHEARSAL_SYSTEM_ID !== undefined
    || env.GRIDLINE_REHEARSAL_NOW !== undefined
    || env.GRIDLINE_NEW_WORKER_APPROVED !== "1") {
    throw new Error("Data worker refused: normal approval or rehearsal settings invalid");
  }
  return null;
}

export function assertRehearsalConfiguration(env: WorkerEnvironment): URL {
  if (!rehearsalRequested(env)
    || env.GRIDLINE_NEW_WORKER_APPROVED === "1"
    || env.GRIDLINE_REHEARSAL_NO_PROVIDERS !== "1"
    || env.GRIDLINE_REHEARSAL_NO_SCHEDULED_EXECUTION !== "1"
    || env.GRIDLINE_REHEARSAL_NO_RETENTION !== "1"
    || env.GRIDLINE_SCHEDULER_WORKER === "1"
    || !env.GRIDLINE_REHEARSAL_NOW
    || !Number.isFinite(Date.parse(env.GRIDLINE_REHEARSAL_NOW))
    || !/^[a-f0-9]{32,64}$/.test(env.GRIDLINE_REHEARSAL_MARKER ?? "")
    || !/^\d{10,30}$/.test(env.GRIDLINE_REHEARSAL_SYSTEM_ID ?? "")) {
    throw new Error("Worker rehearsal refused: isolation and inert-execution controls are required");
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Worker rehearsal refused: invalid database address");
  }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || !/^\d{2,5}$/.test(url.port) || Number(url.port) < 1024
    || url.pathname !== "/gridline_rehearsal" || url.password || url.search
    || url.hash || url.username !== userInfo().username) {
    throw new Error("Worker rehearsal refused: database must be a named local disposable cluster");
  }
  return url;
}

/** Process-wide fail-closed guard, installed before loading provider modules. */
export function installRehearsalGuards(env: WorkerEnvironment) {
  const url = assertRehearsalConfiguration(env);
  const port = Number(url.port);
  const previousConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: Parameters<typeof previousConnect>) {
    const target = (args as unknown[])[0];
    const options = typeof target === "object" && target !== null
      ? target as { host?: string; port?: number | string } : null;
    const host = options?.host ?? (args as unknown[])[1];
    const targetPort = options?.port ?? target;
    if (host !== "127.0.0.1" || Number(targetPort) !== port) {
      rehearsalGuardStats.deniedSockets += 1;
      throw new Error("Rehearsal outbound socket blocked");
    }
    return previousConnect.apply(this, args);
  } as typeof previousConnect;
  globalThis.fetch = (async () => {
    rehearsalGuardStats.deniedFetches += 1;
    throw new Error("Rehearsal provider fetch blocked");
  }) as typeof fetch;
  globalThis.setInterval = (() => {
    rehearsalGuardStats.deniedTimers += 1;
    throw new Error("Rehearsal timer blocked");
  }) as typeof setInterval;
}

export function assertNoRehearsalExecutionAttempts() {
  if (Object.values(rehearsalGuardStats).some((count) => count !== 0))
    throw new Error("Rehearsal attempted outbound or timer execution");
}

export async function assertDisposableDatabaseIdentity(
  env: WorkerEnvironment,
  query: (statement: string) => Promise<{ rows: Array<Record<string, unknown>> }>,
) {
  assertRehearsalConfiguration(env);
  const result = await query(`
    SELECT current_database() AS database_name,
      (SELECT system_identifier::text FROM pg_control_system()) AS system_id,
      (SELECT description FROM pg_shdescription
        WHERE objoid = (SELECT oid FROM pg_database WHERE datname = current_database())) AS marker,
      inet_server_addr()::text AS server_address
  `);
  const row = result.rows[0];
  if (row?.database_name !== "gridline_rehearsal"
    || row.system_id !== env.GRIDLINE_REHEARSAL_SYSTEM_ID
    || row.marker !== `gridline-disposable:${env.GRIDLINE_REHEARSAL_MARKER}`
    || !["127.0.0.1", "127.0.0.1/32"].includes(String(row.server_address))) {
    throw new Error("Worker rehearsal refused: disposable cluster identity did not match");
  }
}