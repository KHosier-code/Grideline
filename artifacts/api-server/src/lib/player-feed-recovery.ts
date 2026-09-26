/**
 * One-shot operator path. Keep this module free of provider and database imports:
 * validate intent before opening a connection or loading any feed adapter.
 */
import net from "node:net";
import { randomUUID } from "node:crypto";

export type RecoveryFeed = "injuries" | "sleeper";
export type RecoveryConfig = {
  feeds: RecoveryFeed[];
  database: string;
  role: string;
  systemId: string;
  databaseOid: number;
  serverAddress: string;
  disposable: boolean;
  marker?: string;
};

export type RecoveryAttempt = {
  feed: RecoveryFeed;
  status: "success" | "failed";
  inserted?: number;
  reason?: "locked" | "sync_error";
};

export class RecoveryFeedLockedError extends Error {}

/**
 * Allowlisted stdout receipt: the unique job key links to data_sync_runs without
 * copying provider errors, database identifiers, connection URLs or credentials.
 * Only call after attestation of the connection opened by this worker.
 */
export async function runAttestedPlayerRecovery(
  config: RecoveryConfig,
  runFeed: (feed: RecoveryFeed, jobKey: string) => Promise<{ inserted: number }>,
) {
  const receiptId = randomUUID();
  const jobKey = `operator-player-recovery:${receiptId}`;
  const startedAt = new Date().toISOString();
  const attempts: RecoveryAttempt[] = [];
  for (const feed of config.feeds) {
    try {
      const result = await runFeed(feed, jobKey);
      attempts.push({ feed, status: "success", inserted: result.inserted });
    } catch (error) {
      attempts.push({
        feed,
        status: "failed",
        reason: error instanceof RecoveryFeedLockedError ? "locked" : "sync_error",
      });
    }
  }
  const successes = attempts.filter((attempt) => attempt.status === "success").length;
  return {
    event: "player_recovery_receipt",
    receiptId,
    approvedFeeds: config.feeds,
    target: config.disposable ? "attested_disposable_development_primary" : "attested_development_primary",
    syncRunJobKey: jobKey,
    startedAt,
    completedAt: new Date().toISOString(),
    status: successes === attempts.length ? "success" : successes ? "partial_success" : "failed",
    attempts,
  };
}

export function recoveryRequested(env: NodeJS.ProcessEnv) {
  return env.GRIDLINE_PLAYER_RECOVERY !== undefined;
}

export function assertPlayerRecoveryConfiguration(env: NodeJS.ProcessEnv): RecoveryConfig {
  const selection = env.GRIDLINE_PLAYER_RECOVERY;
  if (!["injuries", "sleeper", "injuries,sleeper"].includes(selection ?? "")
    || env.GRIDLINE_PLAYER_RECOVERY_APPROVED !== "1"
    || env.NODE_ENV !== "development"
    || env.REPLIT_DEPLOYMENT !== undefined
    || env.GRIDLINE_NEW_WORKER_APPROVED !== undefined
    || env.GRIDLINE_SCHEDULER_WORKER !== undefined
    || env.GRIDLINE_WORKER_REHEARSAL !== undefined
    || Object.keys(env).some((key) => key.startsWith("GRIDLINE_REHEARSAL_"))
    || !/^\d{10,30}$/.test(env.GRIDLINE_PLAYER_RECOVERY_SYSTEM_ID ?? "")
    || !/^[1-9]\d*$/.test(env.GRIDLINE_PLAYER_RECOVERY_DATABASE_OID ?? "")
    || !env.GRIDLINE_PLAYER_RECOVERY_DATABASE
    || !env.GRIDLINE_PLAYER_RECOVERY_ROLE
    || !env.GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS) {
    throw new Error("Player recovery refused: exact selection, approval and development identity are required");
  }
  const disposable = env.GRIDLINE_PLAYER_RECOVERY_TEST_BLOCK_NETWORK === "1";
  if (env.GRIDLINE_PLAYER_RECOVERY_TEST_BLOCK_NETWORK !== undefined && !disposable)
    throw new Error("Player recovery refused: invalid network test mode");
  if (env.GRIDLINE_PLAYER_RECOVERY_TEST_FIXTURE !== undefined
    && (!disposable || !["initial", "changed"].includes(env.GRIDLINE_PLAYER_RECOVERY_TEST_FIXTURE)))
    throw new Error("Player recovery refused: synthetic responses require disposable network test mode");
  if (disposable) {
    const url = new URL(env.DATABASE_URL ?? "");
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
      || !url.port || Number(url.port) < 1024 || url.pathname !== "/gridline_rehearsal"
      || url.password || url.search || url.hash
      || env.GRIDLINE_PLAYER_RECOVERY_DATABASE !== "gridline_rehearsal"
      || !/^[a-f0-9]{32,64}$/.test(env.GRIDLINE_PLAYER_RECOVERY_MARKER ?? "")
      || !["127.0.0.1", "127.0.0.1/32"].includes(env.GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS)) {
      throw new Error("Player recovery refused: test mode requires a marked local disposable database");
    }
  } else if (env.GRIDLINE_PLAYER_RECOVERY_DATABASE !== "heliumdb"
    || env.GRIDLINE_PLAYER_RECOVERY_MARKER !== undefined
    || env.GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS !== "local") {
    throw new Error("Player recovery refused: development database identity is not approved");
  }
  return {
    feeds: selection!.split(",") as RecoveryFeed[],
    database: env.GRIDLINE_PLAYER_RECOVERY_DATABASE,
    role: env.GRIDLINE_PLAYER_RECOVERY_ROLE,
    systemId: env.GRIDLINE_PLAYER_RECOVERY_SYSTEM_ID!,
    databaseOid: Number(env.GRIDLINE_PLAYER_RECOVERY_DATABASE_OID),
    serverAddress: env.GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS,
    disposable,
    marker: env.GRIDLINE_PLAYER_RECOVERY_MARKER,
  };
}

export async function attestPlayerRecoveryDatabase(
  config: RecoveryConfig,
  query: (statement: string) => Promise<{ rows: Array<Record<string, unknown>> }>,
) {
  const result = await query(`
    SELECT current_database() AS database_name, current_user AS database_role,
      pg_is_in_recovery() AS replica,
      (SELECT system_identifier::text FROM pg_control_system()) AS system_id,
      (SELECT oid FROM pg_database WHERE datname = current_database()) AS database_oid,
      inet_server_addr()::text AS server_address,
      (SELECT description FROM pg_shdescription
       WHERE objoid = (SELECT oid FROM pg_database WHERE datname = current_database())) AS marker
  `);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || row.replica !== false
    || row.database_name !== config.database || row.database_role !== config.role
    || row.system_id !== config.systemId || Number(row.database_oid) !== config.databaseOid
    || (config.disposable
      ? row.server_address !== config.serverAddress
        || row.marker !== `gridline-disposable:${config.marker}`
      : row.server_address !== null)) {
    throw new Error("Player recovery refused: connected database identity does not match authorization");
  }
}

/** Test only: only the local database socket and explicitly selected synthetic HTTP responses work. */
export function blockRecoveryTestNetwork(env: NodeJS.ProcessEnv) {
  const config = assertPlayerRecoveryConfiguration(env);
  if (!config.disposable) throw new Error("Network blocker is only valid for disposable recovery");
  const port = Number(new URL(env.DATABASE_URL ?? "").port);
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: Parameters<typeof connect>) {
    const target = (args as unknown[])[0];
    const options = typeof target === "object" && target !== null
      ? target as { host?: string; port?: number | string } : null;
    const host = options?.host ?? (args as unknown[])[1];
    const targetPort = options?.port ?? target;
    if (host !== "127.0.0.1" || Number(targetPort) !== port)
      throw new Error("Disposable recovery blocked outbound socket");
    return connect.apply(this, args);
  } as typeof connect;
  const fixture = env.GRIDLINE_PLAYER_RECOVERY_TEST_FIXTURE;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (fixture && typeof input === "string" && (!init?.method || init.method === "GET")) {
      const changed = fixture === "changed";
      if (input === "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries") {
        return Response.json({
          timestamp: "2026-09-20T12:00:00Z",
          injuries: [{
            id: "synthetic-team",
            injuries: [{
              athlete: { id: "synthetic-athlete", displayName: "Fixture Runner", position: { abbreviation: "RB" } },
              status: changed ? "Out" : "Questionable",
              date: "2026-09-20",
              details: { type: "Ankle", fantasyStatus: { description: "Limited" } },
            }],
          }],
        });
      }
      if (input === "https://api.sleeper.app/v1/players/nfl") {
        return Response.json({
          "synthetic-sleeper": {
            player_id: "synthetic-sleeper", full_name: "Fixture Runner", first_name: "Fixture",
            last_name: "Runner", team: "ARI", position: "RB", fantasy_positions: ["RB"],
            depth_chart_position: "RB", depth_chart_order: 1, status: "Active",
            injury_status: changed ? "Out" : "Questionable", espn_id: "synthetic-athlete",
          },
        });
      }
    }
    throw new Error("Disposable recovery blocked provider fetch");
  }) as typeof fetch;
}
