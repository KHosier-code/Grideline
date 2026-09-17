import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, dataSyncRunsTable, sleeperPlayerSnapshotsTable } from "@workspace/db";
import { logger } from "./logger";

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
export const SLEEPER_ACTIVE_TEAM_CODES = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
] as const;
const ACTIVE_TEAM_CODES = new Set<string>(SLEEPER_ACTIVE_TEAM_CODES);
const DEFAULT_INTERVAL_HOURS = 24;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

type RecordValue = Record<string, unknown>;

export type SleeperPlayer = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  team: string | null;
  position: string | null;
  fantasy_positions: string[];
  depth_chart_position: string | null;
  depth_chart_order: number | null;
  status: string | null;
  injury_status: string | null;
  practice_participation: string | null;
  years_exp: number | null;
  age: number | null;
  provider_ids: Record<string, unknown>;
};

export class SleeperProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "http" | "malformed" | "network",
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SleeperProviderError";
  }
}

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function isoTimestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function hashMaterial(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerIds(player: RecordValue) {
  return Object.fromEntries(Object.entries(player)
    .filter(([key, value]) =>
      key !== "player_id" && /(?:^|_)id$/i.test(key) && value !== null && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizePlayer(value: unknown): SleeperPlayer | null {
  const player = record(value);
  const playerId = text(player.player_id);
  if (!playerId) return null;
  const positions = Array.isArray(player.fantasy_positions)
    ? player.fantasy_positions.filter((position): position is string => typeof position === "string")
    : [];
  return {
    player_id: playerId,
    full_name: text(player.full_name),
    first_name: text(player.first_name),
    last_name: text(player.last_name),
    team: text(player.team),
    position: text(player.position),
    fantasy_positions: positions,
    depth_chart_position: text(player.depth_chart_position),
    depth_chart_order: integer(player.depth_chart_order),
    status: text(player.status),
    injury_status: text(player.injury_status),
    practice_participation: text(player.practice_participation),
    years_exp: integer(player.years_exp),
    age: integer(player.age),
    provider_ids: providerIds(player),
  };
}

export function sleeperSyncIntervalHours() {
  const configured = Number(process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 168
    ? configured
    : DEFAULT_INTERVAL_HOURS;
}

export function sleeperSyncIntervalMs() {
  return sleeperSyncIntervalHours() * 60 * 60 * 1000;
}

export function changedSleeperPlayers(
  players: SleeperPlayer[],
  latestHashes: ReadonlyMap<string, string>,
) {
  return players.flatMap((player) => {
    const sourceHash = hashMaterial(player);
    return latestHashes.get(player.player_id) === sourceHash
      ? []
      : [{ player, sourceHash }];
  });
}

export function sleeperTeamCoverage(players: SleeperPlayer[]) {
  const rawTeams = new Set(
    players.map((player) => player.team).filter((team): team is string => Boolean(team)),
  );
  const teams = [...rawTeams].filter((team) => ACTIVE_TEAM_CODES.has(team)).sort();
  return {
    teams,
    teamCount: teams.length,
    rawTeamCount: rawTeams.size,
    unexpectedTeamCodes: [...rawTeams].filter((team) => !ACTIVE_TEAM_CODES.has(team)).sort(),
  };
}

export async function fetchSleeperPlayers(
  fetchImpl: typeof fetch = fetch,
): Promise<SleeperPlayer[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(SLEEPER_PLAYERS_URL, {
        headers: { Accept: "application/json", "User-Agent": "Gridline/0.2 (Sleeper sync)" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new SleeperProviderError(
          `Sleeper players request failed with HTTP ${response.status}`,
          "http",
          response.status,
        );
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new SleeperProviderError("Sleeper returned a malformed players payload", "malformed");
      }
      const players = Object.values(payload)
        .map(normalizePlayer)
        .filter((player): player is SleeperPlayer => player !== null);
      if (players.length === 0) {
        throw new SleeperProviderError("Sleeper returned no valid player records", "malformed");
      }
      return players;
    } catch (error) {
      lastError = error instanceof SleeperProviderError
        ? error
        : error instanceof DOMException && error.name === "TimeoutError"
          ? new SleeperProviderError("Sleeper players request timed out", "timeout", undefined, { cause: error })
          : new SleeperProviderError("Sleeper players request failed due to a network error", "network", undefined, { cause: error });
      logger.warn({ error: lastError, attempt, maxAttempts: MAX_ATTEMPTS }, "Sleeper players request failed");
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError instanceof Error ? lastError : new SleeperProviderError("Sleeper players request failed", "network");
}

async function beginRun(options?: { jobKey?: string; scheduledFor?: Date }) {
  const [run] = await db.insert(dataSyncRunsTable).values({
    provider: "sleeper-players",
    status: "running",
    jobKey: options?.jobKey ?? null,
    scheduledFor: options?.scheduledFor ?? null,
  }).returning({ id: dataSyncRunsTable.id });
  return run.id;
}

export async function syncSleeperPlayers(
  options?: { jobKey?: string; scheduledFor?: Date; fetchImpl?: typeof fetch },
) {
  const runId = await beginRun(options);
  const startedAt = Date.now();
  try {
    // One complete provider response is intentionally reused for the entire cycle.
    const players = await fetchSleeperPlayers(options?.fetchImpl);
    const capturedAt = new Date();
    const snapshotId = randomUUID();
    let depthOrderCount = 0;

    for (const player of players) {
      if (player.depth_chart_order !== null) depthOrderCount += 1;
    }
    const teamCoverage = sleeperTeamCoverage(players);

    const inserted = await db.transaction(async (tx) => {
      // One lock protects the latest-state read and all inserts in this cycle.
      // This suppresses concurrent duplicate cycles while preserving A-B-A history.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sleeper-player-snapshot-cycle'))`);
      const latestRows = await tx.selectDistinctOn(
        [sleeperPlayerSnapshotsTable.sleeperPlayerId],
        {
          sleeperPlayerId: sleeperPlayerSnapshotsTable.sleeperPlayerId,
          sourceHash: sleeperPlayerSnapshotsTable.sourceHash,
        },
      )
        .from(sleeperPlayerSnapshotsTable)
        .orderBy(
          sleeperPlayerSnapshotsTable.sleeperPlayerId,
          desc(sleeperPlayerSnapshotsTable.capturedAt),
          desc(sleeperPlayerSnapshotsTable.id),
        );
      const latestByPlayer = new Map(
        latestRows.map((row) => [row.sleeperPlayerId, row.sourceHash]),
      );
      const changed = changedSleeperPlayers(players, latestByPlayer);
      let rowsInserted = 0;
      for (let index = 0; index < changed.length; index += 500) {
        const rows = changed.slice(index, index + 500).map(({ player, sourceHash }) => ({
          snapshotId,
          capturedAt,
          sleeperPlayerId: player.player_id,
          fullName: player.full_name,
          firstName: player.first_name,
          lastName: player.last_name,
          team: player.team,
          position: player.position,
          fantasyPositions: player.fantasy_positions,
          depthChartPosition: player.depth_chart_position,
          depthChartOrder: player.depth_chart_order,
          status: player.status,
          injuryStatus: player.injury_status,
          practiceParticipation: player.practice_participation,
          yearsExp: player.years_exp,
          age: player.age,
          providerIds: player.provider_ids,
          sourceHash,
          sourceVersion: null,
        }));
        if (!rows.length) continue;
        const result = await tx.insert(sleeperPlayerSnapshotsTable)
          .values(rows)
          .onConflictDoNothing({
            target: [
              sleeperPlayerSnapshotsTable.snapshotId,
              sleeperPlayerSnapshotsTable.sleeperPlayerId,
            ],
          })
          .returning({ id: sleeperPlayerSnapshotsTable.id });
        rowsInserted += result.length;
      }
      return rowsInserted;
    });
    const unchanged = players.length - inserted;

    const metadata = {
      durationMs: Date.now() - startedAt,
      playerCount: players.length,
      snapshotId,
      sourceCapturedAt: capturedAt.toISOString(),
      ...teamCoverage,
      depthOrderCount,
      unchanged,
      capturedAt: capturedAt.toISOString(),
      cadenceHours: sleeperSyncIntervalHours(),
    };
    await db.update(dataSyncRunsTable).set({
      status: "success",
      recordsProcessed: inserted,
      completedAt: new Date(),
      metadata,
    }).where(eq(dataSyncRunsTable.id, runId));
    return { status: "success", inserted, ...metadata };
  } catch (error) {
    const providerError = error instanceof SleeperProviderError
      ? error
      : new SleeperProviderError("Sleeper synchronization failed", "network", undefined, { cause: error });
    await db.update(dataSyncRunsTable).set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: providerError.message,
      metadata: { durationMs: Date.now() - startedAt, errorKind: providerError.kind },
    }).where(eq(dataSyncRunsTable.id, runId));
    logger.error({ error: providerError }, "Sleeper players synchronization failed");
    throw providerError;
  }
}

export async function getSleeperHealth() {
  const [summary] = await db.select({
    snapshotCount: sql<number>`count(*)::int`,
    lastCapturedAt: sql<Date | null>`max(${sleeperPlayerSnapshotsTable.capturedAt})`,
  }).from(sleeperPlayerSnapshotsTable);
  const [latestSuccess] = await db.select().from(dataSyncRunsTable)
    .where(and(eq(dataSyncRunsTable.provider, "sleeper-players"), eq(dataSyncRunsTable.status, "success")))
    .orderBy(desc(dataSyncRunsTable.startedAt)).limit(1);
  const [latestAttempt] = await db.select().from(dataSyncRunsTable)
    .where(eq(dataSyncRunsTable.provider, "sleeper-players"))
    .orderBy(desc(dataSyncRunsTable.startedAt)).limit(1);
  const recentAttempts = await db.select({
    status: dataSyncRunsTable.status,
  }).from(dataSyncRunsTable)
    .where(eq(dataSyncRunsTable.provider, "sleeper-players"))
    .orderBy(desc(dataSyncRunsTable.startedAt)).limit(50);
  const lastUpdated = latestSuccess?.completedAt ?? null;
  const staleAgeMs = lastUpdated ? Math.max(0, Date.now() - lastUpdated.getTime()) : null;
  const stale = staleAgeMs === null || staleAgeMs > sleeperSyncIntervalMs() * 2;
  const latestMetadata = latestSuccess?.metadata ?? {};
  const playerCount = typeof latestMetadata.playerCount === "number" ? latestMetadata.playerCount : 0;
  const teamCount = typeof latestMetadata.teamCount === "number" ? latestMetadata.teamCount : 0;
  const depthOrderCount = typeof latestMetadata.depthOrderCount === "number" ? latestMetadata.depthOrderCount : 0;
  return {
    status: stale ? (summary?.snapshotCount ? "stale" : "unavailable") : "current",
    lastUpdated: lastUpdated?.toISOString() ?? null,
    staleAgeMs,
    snapshotCount: summary?.snapshotCount ?? 0,
    lastCapturedAt: isoTimestamp(summary?.lastCapturedAt),
    playerCount,
    teamCount,
    depthOrderCount,
    lastAttempted: latestAttempt?.startedAt.toISOString() ?? null,
    latestFailure: latestAttempt?.status === "failed" ? latestAttempt.errorMessage : null,
    recentFailureCount: recentAttempts.filter((attempt) => attempt.status === "failed").length,
    latestMetadata,
    cadenceHours: sleeperSyncIntervalHours(),
  };
}