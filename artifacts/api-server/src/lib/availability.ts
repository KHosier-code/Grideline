import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  depthChartSnapshotsTable,
  espnRosterObservationsTable,
  injuriesTable,
  playersTable,
  pool,
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
    if (groups.length === 0 || groups.some((value) => !value || typeof value !== "object"
      || !Array.isArray(record(value).injuries)
      || (record(value).injuries as unknown[]).some((entry) => {
        const athlete = record(record(entry).athlete);
        return !athlete.id && !text(athlete.displayName);
      }))) {
      throw new Error("ESPN returned empty or incomplete injury groups");
    }
    if (!Number.isFinite(sourceUpdatedAt.getTime())) {
      throw new Error("ESPN returned an invalid injury publication timestamp");
    }
    let inserted = 0;
    let unchanged = 0;
    let observed = 0;
    for (const groupValue of groups) {
      const group = record(groupValue);
      const teamId = String(group.id ?? "unknown");
      const entries = Array.isArray(group.injuries) ? group.injuries : [];
      for (const entryValue of entries) {
        const entry = record(entryValue);
        const athlete = record(entry.athlete);
        observed += 1;
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
    if (!observed) throw new Error("ESPN returned no injury records");
    await db.update(dataSyncRunsTable).set({
      status: "success", recordsProcessed: inserted, completedAt: new Date(),
      metadata: {
        observationKind: "injury-only",
        responseComplete: true,
        groupCount: groups.length,
        observedCount: observed,
        unchanged,
        retrievedAt: new Date().toISOString(),
        publicationAt: text(payload.timestamp) ? sourceUpdatedAt.toISOString() : null,
        publicationProvenance: text(payload.timestamp) ? "payload" : "not_provided",
      },
    }).where(eq(dataSyncRunsTable.id, runId));
    return { status: "success", inserted, unchanged, sourceUpdatedAt: sourceUpdatedAt.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId, "failed", 0, message);
    logger.error({ error }, "ESPN injury synchronization failed");
    throw error;
  }
}

export type EspnRosterEntry = {
  playerId: string;
  playerName: string;
  position: string | null;
  activeStatus: string | null;
};

/** ESPN's team roster is grouped by position; reject truncated or unidentified rows. */
export function parseEspnTeamRoster(payload: RecordValue, teamId: string): EspnRosterEntry[] {
  const groups = payload.athletes;
  if (!Array.isArray(groups) || groups.length === 0) throw new Error(`Incomplete ESPN roster for team ${teamId}`);
  const result: EspnRosterEntry[] = [];
  const ids = new Set<string>();
  for (const value of groups) {
    const group = record(value);
    if (!Array.isArray(group.items) || group.items.length === 0) {
      throw new Error(`Incomplete ESPN roster group for team ${teamId}`);
    }
    for (const item of group.items) {
      const athlete = record(item);
      const id = String(athlete.id ?? "");
      const name = text(athlete.displayName) ?? text(athlete.fullName);
      if (!/^\d+$/.test(id) || !name || ids.has(id)) {
        throw new Error(`Invalid or duplicate ESPN roster identity for team ${teamId}`);
      }
      ids.add(id);
      result.push({
        playerId: id,
        playerName: name,
        position: text(record(athlete.position).abbreviation) ?? text(record(group.position).abbreviation),
        activeStatus: text(record(athlete.status).name) ?? text(athlete.status),
      });
    }
  }
  return result;
}

export const ESPN_ROSTER_CONFIRMATION = "--confirm-development-espn-rosters";

// This is deliberately a manual, development-only command, not a route or
// scheduled job. Check the destination before creating a run or fetching ESPN.
export async function assertDevelopmentRosterCaptureTarget(confirmation: string) {
  if (confirmation !== ESPN_ROSTER_CONFIRMATION
    || process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("ESPN roster capture requires explicit development confirmation and cannot run in a deployment");
  }
  const { rows } = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
           pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy,
           to_regclass('public.espn_roster_observations') IS NOT NULL AS roster_schema_ready
  `);
  const identity = rows[0] as
    | { database_name: string; database_role: string; replica: boolean;
        local_proxy: boolean; roster_schema_ready: boolean }
    | undefined;
  if (rows.length !== 1 || identity?.database_name !== "heliumdb"
    || identity.database_role !== "postgres" || identity.replica
    || !identity.local_proxy || !identity.roster_schema_ready) {
    throw new Error("Refusing ESPN roster capture: the target is not the verified, migrated development database");
  }
}

export async function syncEspnCompleteRosters(confirmation: string) {
  await assertDevelopmentRosterCaptureTarget(confirmation);
  const runId = await beginRun("espn-complete-rosters");
  try {
    const teams = await fetchTeams();
    if (teams.length !== 32 || new Set(teams.map((team) => team.teamId)).size !== 32
      || teams.some((team) => !/^\d+$/.test(team.teamId))) {
      throw new Error("ESPN team listing does not contain 32 distinct identified teams");
    }
    const captures: Array<{
      teamId: string; path: string; entries: EspnRosterEntry[];
      observedAt: Date; publicationAt: Date | null;
    }> = [];
    const allIds = new Set<string>();
    for (const team of teams) {
      const path = `/teams/${team.teamId}/roster`;
      const payload = await fetchJsonWithRetry(path);
      const observedAt = new Date();
      const publicationAt = text(payload.timestamp) ? new Date(String(payload.timestamp)) : null;
      if (publicationAt && (!Number.isFinite(publicationAt.getTime()) || publicationAt > observedAt)) {
        throw new Error(`Invalid ESPN roster publication time for team ${team.teamId}`);
      }
      const payloadTeamId = record(payload.team).id;
      if (payloadTeamId != null && String(payloadTeamId) !== team.teamId) {
        throw new Error(`ESPN roster team identity mismatch for team ${team.teamId}`);
      }
      const entries = parseEspnTeamRoster(payload, team.teamId);
      if (entries.length < 30) {
        throw new Error(`ESPN roster for team ${team.teamId} is too small to establish complete coverage`);
      }
      for (const entry of entries) {
        if (allIds.has(entry.playerId)) {
          throw new Error(`ESPN roster assigned player ${entry.playerId} to multiple teams`);
        }
        allIds.add(entry.playerId);
      }
      captures.push({ teamId: team.teamId, path, entries, observedAt, publicationAt });
    }
    // An entire 32-team response is one atomic observation; no partial team
    // capture can be published as a verified run.
    await db.transaction(async (tx) => {
      for (const capture of captures) {
        for (const entry of capture.entries) {
          await tx.insert(espnRosterObservationsTable).values({
            runId, playerId: entry.playerId, teamId: capture.teamId,
            playerName: entry.playerName, position: entry.position,
            activeStatus: entry.activeStatus, sourcePath: capture.path,
            sourceHash: hashMaterial({ teamId: capture.teamId, ...entry }),
            observedAt: capture.observedAt, publicationAt: capture.publicationAt,
          });
          await tx.insert(playersTable).values({
            playerId: entry.playerId, teamId: capture.teamId, name: entry.playerName,
            position: entry.position, activeStatus: entry.activeStatus,
            sourceUpdatedAt: capture.observedAt,
          }).onConflictDoUpdate({
            target: playersTable.playerId,
            set: { teamId: capture.teamId, name: entry.playerName, position: entry.position,
              activeStatus: entry.activeStatus, sourceUpdatedAt: capture.observedAt },
            setWhere: sql`(${playersTable.teamId}, ${playersTable.name}, ${playersTable.position}, ${playersTable.activeStatus})
              IS DISTINCT FROM (${capture.teamId}, ${entry.playerName}, ${entry.position}, ${entry.activeStatus})`,
          });
        }
      }
      await tx.update(dataSyncRunsTable).set({
        status: "success", recordsProcessed: allIds.size, completedAt: new Date(),
        metadata: { observationKind: "complete-espn-rosters", responseComplete: true,
          teamCount: captures.length, teams: captures.map((capture) => capture.teamId),
          observedCount: allIds.size, retrievedAt: captures[captures.length - 1]!.observedAt.toISOString() },
      }).where(eq(dataSyncRunsTable.id, runId));
    });
    return { status: "success", observed: allIds.size, teams: captures.length };
  } catch (error) {
    await finishRun(runId, "failed", 0, error instanceof Error ? error.message : String(error));
    logger.error({ error }, "ESPN complete roster synchronization failed");
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
          source: "espn_depth_chart",
          classification: "published_secondary",
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
            source: "espn_depth_chart",
            classification: "published_secondary",
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
