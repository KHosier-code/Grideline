import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  depthChartSnapshotsTable,
  injuriesTable,
  playersTable,
  teamsTable,
} from "@workspace/db";
import { fetchTeams } from "./espn";
import { logger } from "./logger";

const espnBaseUrl = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" ? value as RecordValue : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hashMaterial(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function shouldInsertLatestState(previousHash: string | null | undefined, nextHash: string) {
  return previousHash !== nextHash;
}

async function fetchJsonWithRetry(path: string, attempts = 3): Promise<RecordValue> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${espnBaseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "Gridline/0.2" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return record(await response.json());
    } catch (error) {
      lastError = error;
      logger.warn({ error, path, attempt }, "ESPN availability request failed");
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ESPN availability request failed");
}

function athleteId(athlete: RecordValue, fallback: string) {
  if (athlete.id) return String(athlete.id);
  const links = Array.isArray(athlete.links) ? athlete.links : [];
  for (const item of links) {
    const match = text(record(item).href)?.match(/\/id\/(\d+)/);
    if (match) return match[1];
  }
  return fallback;
}

async function beginRun(provider: string, options?: { jobKey?: string; scheduledFor?: Date }) {
  const [run] = await db
    .insert(dataSyncRunsTable)
    .values({
      provider,
      status: "running",
      jobKey: options?.jobKey ?? null,
      scheduledFor: options?.scheduledFor ?? null,
    })
    .returning({ id: dataSyncRunsTable.id });
  return run.id;
}

async function finishRun(id: number, status: string, recordsProcessed: number, errorMessage: string | null) {
  await db
    .update(dataSyncRunsTable)
    .set({ status, recordsProcessed, errorMessage, completedAt: new Date() })
    .where(eq(dataSyncRunsTable.id, id));
}

export async function syncEspnInjuries(options?: { jobKey?: string; scheduledFor?: Date }) {
  const runId = await beginRun("espn-injuries", options);
  try {
    const payload = await fetchJsonWithRetry("/injuries");
    if (!Array.isArray(payload.injuries)) {
      throw new Error("ESPN returned malformed injury payload: injuries must be an array");
    }
    const sourceUpdatedAt = text(payload.timestamp) ? new Date(String(payload.timestamp)) : new Date();
    const groups = payload.injuries;
    let inserted = 0;
    let unchanged = 0;
    for (const groupValue of groups) {
      const group = record(groupValue);
      const teamId = String(group.id ?? "unknown");
      const entries = Array.isArray(group.injuries) ? group.injuries : [];
      for (const entryValue of entries) {
        const entry = record(entryValue);
        const athlete = record(entry.athlete);
        const position = record(athlete.position);
        const details = record(entry.details);
        const playerName = text(athlete.displayName) ?? "Unknown player";
        const playerId = athleteId(athlete, `${teamId}:${playerName.toLowerCase().replace(/\s+/g, "-")}`);
        const injury = text(details.type) ?? text(details.location) ?? null;
        const practiceStatus = text(record(details.fantasyStatus).description);
        const gameStatus = text(entry.status) ?? text(record(entry.type).description);
        const material = {
          teamId,
          playerId,
          position: text(position.abbreviation),
          injury,
          practiceStatus,
          gameStatus,
          sourceDate: text(entry.date),
          details: text(details.detail),
          side: text(details.side),
        };
        const sourceHash = hashMaterial(material);
        const changed = await db.transaction(async (tx) => {
          // The latest-state check and immutable insert share one advisory
          // transaction lock. This permits A-B-A while preventing concurrent
          // captures from appending the same current state twice.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`injury:${teamId}:${playerId}`}))`);
          const [latest] = await tx
            .select({ sourceHash: injuriesTable.sourceHash })
            .from(injuriesTable)
            .where(and(eq(injuriesTable.playerId, playerId), eq(injuriesTable.teamId, teamId)))
            .orderBy(desc(injuriesTable.snapshotTimestamp), desc(injuriesTable.id))
            .limit(1);
          if (!shouldInsertLatestState(latest?.sourceHash, sourceHash)) return false;
          await tx
            .insert(playersTable)
            .values({
              playerId,
              name: playerName,
              teamId,
              position: text(position.abbreviation),
              activeStatus: gameStatus,
              sourceUpdatedAt,
            })
            .onConflictDoUpdate({
              target: playersTable.playerId,
              set: { name: playerName, teamId, position: text(position.abbreviation), activeStatus: gameStatus, sourceUpdatedAt },
            });
          await tx.insert(injuriesTable).values({
            playerId,
            teamId,
            position: text(position.abbreviation),
            injury,
            practiceStatus,
            gameStatus,
            dateReported: text(entry.date)?.slice(0, 10) ?? null,
            sourceUpdatedAt,
            sourceHash,
            snapshotTimestamp: new Date(),
          });
          return true;
        });
        if (changed) inserted += 1;
        else unchanged += 1;
      }
    }
    await finishRun(runId, "success", inserted, null);
    return { status: "success", inserted, unchanged, sourceUpdatedAt: sourceUpdatedAt.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId, "failed", 0, message);
    logger.error({ error }, "ESPN injury synchronization failed");
    throw error;
  }
}

type DepthEntry = {
  playerId: string;
  playerName: string;
  position: string | null;
  depthPosition: number;
};

function parseDepthEntries(payload: RecordValue): DepthEntry[] {
  const groups = Array.isArray(payload.depthChart)
    ? payload.depthChart
    : Array.isArray(payload.depthchart)
      ? payload.depthchart
      : [];
  const entries: DepthEntry[] = [];
  for (const groupValue of groups) {
    const group = record(groupValue);
    const position = text(group.position) ?? text(group.abbreviation);
    const athletes = Array.isArray(group.athletes) ? group.athletes : Array.isArray(group.items) ? group.items : [];
    athletes.forEach((athleteValue, index) => {
      const athlete = record(athleteValue);
      const playerName = text(athlete.displayName) ?? text(athlete.fullName);
      if (!playerName) return;
      entries.push({
        playerId: athleteId(athlete, `${position ?? "UNK"}:${playerName.toLowerCase().replace(/\s+/g, "-")}`),
        playerName,
        position: text(record(athlete.position).abbreviation) ?? position,
        depthPosition: Number(athlete.depth ?? athlete.rank ?? index + 1),
      });
    });
  }
  return entries;
}

export async function syncEspnDepthCharts(options?: { jobKey?: string; scheduledFor?: Date }) {
  const runId = await beginRun("espn-depth-charts", options);
  const teams = await fetchTeams();
  const failures: string[] = [];
  let teamsUpdated = 0;
  let inserted = 0;
  for (const team of teams) {
    try {
      const payload = await fetchJsonWithRetry(`/teams/${team.teamId}/depthchart`);
      const entries = parseDepthEntries(payload);
      if (entries.length === 0) throw new Error("ESPN returned no structured depth-chart rows");
      const sourceUpdatedAt = text(payload.timestamp) ? new Date(String(payload.timestamp)) : new Date();
      const previous = await db
        .select()
        .from(depthChartSnapshotsTable)
        .where(eq(depthChartSnapshotsTable.teamId, team.teamId))
        .orderBy(desc(depthChartSnapshotsTable.snapshotTimestamp));
      const priorByPlayer = new Map<string, typeof previous[number]>();
      for (const item of previous) if (!priorByPlayer.has(item.playerId)) priorByPlayer.set(item.playerId, item);
      const currentIds = new Set(entries.map((item) => item.playerId));
      for (const item of entries) {
        const prior = priorByPlayer.get(item.playerId);
        const changeType = !prior
          ? item.depthPosition === 1 ? "new_starter" : "player_added"
          : item.depthPosition < (prior.depthPosition ?? 99)
            ? item.depthPosition === 1 ? "new_starter" : "moved_up"
            : item.depthPosition > (prior.depthPosition ?? 99)
              ? "moved_down"
              : null;
        const sourceHash = hashMaterial({ teamId: team.teamId, ...item });
        const [existing] = await db
          .select({ id: depthChartSnapshotsTable.id })
          .from(depthChartSnapshotsTable)
          .where(and(
            eq(depthChartSnapshotsTable.teamId, team.teamId),
            eq(depthChartSnapshotsTable.playerId, item.playerId),
            eq(depthChartSnapshotsTable.sourceHash, sourceHash),
          ))
          .limit(1);
        if (existing) continue;
        await db.insert(depthChartSnapshotsTable).values({
          teamId: team.teamId,
          playerId: item.playerId,
          playerName: item.playerName,
          position: item.position,
          depthPosition: item.depthPosition,
          starter: item.depthPosition === 1,
          role: item.depthPosition === 1 ? "starter" : "backup",
          changeType,
          sourceHash,
          sourceUpdatedAt,
          snapshotTimestamp: new Date(),
        });
        inserted += 1;
      }
      for (const [playerId, prior] of priorByPlayer) {
        if (currentIds.has(playerId)) continue;
        const sourceHash = hashMaterial({ teamId: team.teamId, playerId, position: prior.position, removed: true });
        const [existing] = await db
          .select({ id: depthChartSnapshotsTable.id })
          .from(depthChartSnapshotsTable)
          .where(and(
            eq(depthChartSnapshotsTable.teamId, team.teamId),
            eq(depthChartSnapshotsTable.playerId, playerId),
            eq(depthChartSnapshotsTable.sourceHash, sourceHash),
          ))
          .limit(1);
        if (!existing) {
          await db.insert(depthChartSnapshotsTable).values({
            teamId: team.teamId,
            playerId,
            playerName: prior.playerName,
            position: prior.position,
            depthPosition: prior.depthPosition,
            starter: false,
            role: "removed",
            changeType: "player_removed",
            sourceHash,
            sourceUpdatedAt,
            snapshotTimestamp: new Date(),
          });
          inserted += 1;
        }
      }
      teamsUpdated += 1;
    } catch (error) {
      const message = `${team.abbreviation}: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(message);
      logger.error({ error, teamId: team.teamId, team: team.abbreviation }, "ESPN depth-chart synchronization failed for team");
    }
  }
  const status = failures.length === 0 ? "success" : teamsUpdated > 0 ? "partial" : "failed";
  await finishRun(runId, status, inserted, failures.length ? failures.join("; ").slice(0, 8_000) : null);
  return { status, inserted, teamsUpdated, failures };
}

export async function getAvailabilityHealth() {
  const [injurySummary] = await db
    .select({
      records: sql<number>`count(*)::int`,
    })
    .from(injuriesTable);
  const [depthSummary] = await db
    .select({
      records: sql<number>`count(*)::int`,
      teams: sql<number>`count(distinct ${depthChartSnapshotsTable.teamId})::int`,
      lastUpdated: sql<Date | null>`max(${depthChartSnapshotsTable.snapshotTimestamp})`,
    })
    .from(depthChartSnapshotsTable);
  const recentRuns = await db
    .select()
    .from(dataSyncRunsTable)
    .where(sql`${dataSyncRunsTable.provider} in ('espn-injuries', 'espn-depth-charts')`)
    .orderBy(desc(dataSyncRunsTable.startedAt))
    .limit(20);
  const [[latestInjurySuccess], [latestInjuryFailure], [latestDepthFailure]] = await Promise.all([
    db
      .select({ completedAt: dataSyncRunsTable.completedAt })
      .from(dataSyncRunsTable)
      .where(and(eq(dataSyncRunsTable.provider, "espn-injuries"), eq(dataSyncRunsTable.status, "success")))
      .orderBy(desc(dataSyncRunsTable.completedAt))
      .limit(1),
    db
      .select({
        errorMessage: dataSyncRunsTable.errorMessage,
        startedAt: dataSyncRunsTable.startedAt,
        completedAt: dataSyncRunsTable.completedAt,
      })
      .from(dataSyncRunsTable)
      .where(and(eq(dataSyncRunsTable.provider, "espn-injuries"), eq(dataSyncRunsTable.status, "failed")))
      .orderBy(desc(dataSyncRunsTable.startedAt))
      .limit(1),
    db
      .select({ errorMessage: dataSyncRunsTable.errorMessage })
      .from(dataSyncRunsTable)
      .where(and(eq(dataSyncRunsTable.provider, "espn-depth-charts"), eq(dataSyncRunsTable.status, "failed")))
      .orderBy(desc(dataSyncRunsTable.startedAt))
      .limit(1),
  ]);
  const latestInjuryFailureAt = latestInjuryFailure?.completedAt ?? latestInjuryFailure?.startedAt ?? null;
  return {
    injury: {
      records: injurySummary?.records ?? 0,
      lastUpdated: latestInjurySuccess?.completedAt ? new Date(latestInjurySuccess.completedAt).toISOString() : null,
      failure: latestInjuryFailure
        ? latestInjuryFailure.errorMessage ?? "Injury synchronization failed."
        : null,
      failureAt: latestInjuryFailureAt ? new Date(latestInjuryFailureAt).toISOString() : null,
    },
    depth: {
      records: depthSummary?.records ?? 0,
      teams: depthSummary?.teams ?? 0,
      lastUpdated: depthSummary?.lastUpdated ? new Date(depthSummary.lastUpdated).toISOString() : null,
      failures: latestDepthFailure?.errorMessage?.split("; ").filter(Boolean) ?? [],
    },
    runs: recentRuns.map((run) => ({
      id: run.id,
      provider: run.provider,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      recordsProcessed: run.recordsProcessed,
      errorMessage: run.errorMessage,
      skipReason: run.skipReason,
    })),
  };
}
