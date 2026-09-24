import { desc, eq, sql } from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  gamesTable,
  injuriesTable,
  oddsApiRequestsTable,
  sleeperPlayerSnapshotsTable,
  sportsbookOddsTable,
} from "@workspace/db";

export type ConsumerSourceStatus = "healthy" | "partial" | "stale" | "unavailable";
export type ConsumerSourceName = "schedule" | "injuries" | "odds" | "players";

export type ConsumerSourceHealth = {
  status: ConsumerSourceStatus;
  sources: Record<ConsumerSourceName, {
    status: ConsumerSourceStatus;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    sourceTimestamp: string | null;
    lastAttemptStatus: string | null;
    message: string | null;
    staleAfterMinutes: number;
  }>;
};

type SourceAssessmentInput = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  sourceTimestamp: Date | null;
  lastAttemptStatus: string | null;
  hasSource: boolean;
  staleAfterMinutes: number;
  now: Date;
  partialMessage?: string | null;
  observationRequired?: boolean;
};

/**
 * Evaluate the independent source ledger and source observation timestamps.
 * A success timestamp is supplied only from a success row; it is never
 * synthesized from the most recent attempt.
 */
export function assessConsumerSource(input: SourceAssessmentInput): ConsumerSourceHealth["sources"][ConsumerSourceName] {
  const {
    lastAttemptAt, lastSuccessAt, sourceTimestamp, lastAttemptStatus,
    hasSource, staleAfterMinutes, now, partialMessage, observationRequired,
  } = input;
  const messageForAttempt = lastAttemptStatus === "failed"
    ? "The most recent source attempt failed."
    : lastAttemptStatus === "partial"
      ? "The most recent source attempt completed partially."
      : lastAttemptStatus === "running"
        ? "A source attempt is currently running."
        : null;

  let status: ConsumerSourceStatus;
  let message: string | null = null;
  if (!hasSource && !lastAttemptAt) {
    status = "unavailable";
    message = "No source records or synchronization attempts are available.";
  } else if (!lastSuccessAt) {
    status = "unavailable";
    message = messageForAttempt ?? "No successful source synchronization is recorded.";
  } else {
    const freshnessAt = observationRequired ? sourceTimestamp : lastSuccessAt;
    if (!freshnessAt || freshnessAt > now) {
      return {
        status: "unavailable", lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
        sourceTimestamp: sourceTimestamp?.toISOString() ?? null, lastAttemptStatus,
        message: "No valid source observation is available.", staleAfterMinutes,
      };
    }
    const ageMinutes = (now.getTime() - freshnessAt.getTime()) / 60_000;
    if (!hasSource) {
      status = "unavailable";
      message = "Synchronization succeeded but no source observations are available.";
    } else if (ageMinutes > staleAfterMinutes) {
      status = "stale";
      message = "The latest source observation is older than its freshness threshold.";
    } else if (partialMessage || messageForAttempt) {
      status = "partial";
      message = partialMessage ?? messageForAttempt;
    } else {
      status = "healthy";
    }
  }

  return {
    status,
    lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    sourceTimestamp: sourceTimestamp?.toISOString() ?? null,
    lastAttemptStatus,
    message,
    staleAfterMinutes,
  };
}

function aggregateStatus(sources: ConsumerSourceHealth["sources"]): ConsumerSourceStatus {
  const statuses = Object.values(sources).map((source) => source.status);
  if (statuses.every((status) => status === "unavailable")) return "unavailable";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("partial") || statuses.includes("unavailable")) return "partial";
  return "healthy";
}

function staleAfterInjuryMinutes(now: Date, upcomingGameDates: Date[]) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const key = `${values.year}-${values.month}-${values.day}`;
  const hasGameToday = upcomingGameDates.some((date) => {
    const gameParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(date);
    const game = Object.fromEntries(gameParts.map((part) => [part.type, part.value]));
    return `${game.year}-${game.month}-${game.day}` === key;
  });
  const month = Number(values.month);
  if (month < 8 && month > 2) return 8 * 24 * 60; // One weekly Wednesday off-season slot plus grace.
  // ESPN injuries are checked about every three hours on game days. On active
  // off-days the scheduler's fixed slots can be separated by roughly 47 hours.
  return hasGameToday ? 4 * 60 : 50 * 60;
}

function sleeperStaleAfterMinutes() {
  const configuredHours = Number(process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS ?? 24);
  const intervalHours = Number.isFinite(configuredHours) && configuredHours >= 1 && configuredHours <= 168
    ? configuredHours
    : 24;
  // The health endpoint uses the same two-cycle tolerance as Sleeper's health.
  return intervalHours * 120;
}

function runDates(runs: Array<{ startedAt: Date; completedAt: Date | null; status: string }>) {
  const latestAttempt = runs[0] ?? null;
  const latestSuccess = runs.find((run) => run.status === "success") ?? null;
  return {
    lastAttemptAt: latestAttempt?.startedAt ?? null,
    lastAttemptStatus: latestAttempt?.status ?? null,
    lastSuccessAt: latestSuccess?.completedAt ?? null,
  };
}

function aggregateDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** A complete Sleeper response is an observation even if no player changed. */
export function playerObservationAt(
  runs: Array<{ status: string; completedAt: Date | null; metadata: unknown }>,
  snapshotTimestamp: Date | null,
): Date | null {
  const latest = runs.find((run) => run.status === "success");
  if (!latest || !latest.metadata || typeof latest.metadata !== "object") return snapshotTimestamp;
  const metadata = latest.metadata as Record<string, unknown>;
  const count = metadata.playerCount;
  const capture = metadata.sourceCapturedAt;
  const observedAt = typeof capture === "string" ? aggregateDate(capture) : null;
  if (typeof count !== "number" || count <= 0 || !Number.isInteger(count)
    || !observedAt || !latest.completedAt || observedAt > latest.completedAt) return snapshotTimestamp;
  return !snapshotTimestamp || observedAt > snapshotTimestamp ? observedAt : snapshotTimestamp;
}

/**
 * Read-only consumer-facing health summary for schedule, injury, odds, and
 * Sleeper player sources.
 *
 * Thresholds follow the configured workers: schedule runs every 30 minutes;
 * odds quotes use the 15-minute quote freshness limit; injury freshness
 * follows game-day/off-day and offseason feed slots; Sleeper allows two
 * configured sync intervals (24 hours by default).
 */
export async function getConsumerSourceHealth(now = new Date()): Promise<ConsumerSourceHealth> {
  const [
    [scheduleData],
    [injuryData],
    [oddsData],
    [playerData],
    scheduleRuns,
    injuryRuns,
    playerRuns,
    oddsRequests,
    upcomingGames,
  ] = await Promise.all([
    db.select({
      count: sql<number>`count(*)::int`,
       sourceTimestamp: sql<Date | null>`max(${gamesTable.sourceUpdatedAt})`,
    }).from(gamesTable),
    db.select({
      count: sql<number>`count(*)::int`,
       sourceTimestamp: sql<Date | null>`max(${injuriesTable.snapshotTimestamp})`,
    }).from(injuriesTable),
    db.select({
      count: sql<number>`count(*)::int`,
      capturedAt: sql<Date | null>`max(${sportsbookOddsTable.capturedAt})`,
       sourceTimestamp: sql<Date | null>`max(${sportsbookOddsTable.capturedAt})`,
    }).from(sportsbookOddsTable),
    db.select({
      count: sql<number>`count(*)::int`,
      capturedAt: sql<Date | null>`max(${sleeperPlayerSnapshotsTable.capturedAt})`,
      sourceTimestamp: sql<Date | null>`max(${sleeperPlayerSnapshotsTable.sourceTimestamp})`,
    }).from(sleeperPlayerSnapshotsTable),
    db.select({ startedAt: dataSyncRunsTable.startedAt, completedAt: dataSyncRunsTable.completedAt, status: dataSyncRunsTable.status })
      .from(dataSyncRunsTable).where(eq(dataSyncRunsTable.provider, "espn-schedule"))
      .orderBy(desc(dataSyncRunsTable.startedAt), desc(dataSyncRunsTable.id)).limit(100),
    db.select({ startedAt: dataSyncRunsTable.startedAt, completedAt: dataSyncRunsTable.completedAt, status: dataSyncRunsTable.status })
      .from(dataSyncRunsTable).where(eq(dataSyncRunsTable.provider, "espn-injuries"))
      .orderBy(desc(dataSyncRunsTable.startedAt), desc(dataSyncRunsTable.id)).limit(100),
    db.select({ startedAt: dataSyncRunsTable.startedAt, completedAt: dataSyncRunsTable.completedAt, status: dataSyncRunsTable.status, metadata: dataSyncRunsTable.metadata })
      .from(dataSyncRunsTable).where(eq(dataSyncRunsTable.provider, "sleeper-players"))
      .orderBy(desc(dataSyncRunsTable.startedAt), desc(dataSyncRunsTable.id)).limit(100),
    db.select({
      requestedAt: oddsApiRequestsTable.requestedAt,
      status: oddsApiRequestsTable.status,
      metadata: oddsApiRequestsTable.metadata,
    }).from(oddsApiRequestsTable).orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id)).limit(100),
    db.select({ gameDate: gamesTable.gameDate, kickoffTime: gamesTable.kickoffTime })
      .from(gamesTable)
      .where(sql`${gamesTable.kickoffTime} >= ${now} and lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%' and lower(${gamesTable.gameStatus}) not like '%canceled%'`),
  ]);

  const scheduleTimes = runDates(scheduleRuns);
  const injuryTimes = runDates(injuryRuns);
  const playerTimes = runDates(playerRuns);
  const latestOddsRequest = oddsRequests[0] ?? null;
  const latestOddsSuccess = oddsRequests.find((request) => request.status === "success") ?? null;
  const oddsMeta = latestOddsRequest?.metadata ?? {};
  const oddsPartialMessage = latestOddsRequest?.status === "success" &&
      ((Array.isArray(oddsMeta.missingMarkets) && oddsMeta.missingMarkets.length > 0) ||
       (Array.isArray(oddsMeta.failedSportsbooks) && oddsMeta.failedSportsbooks.length > 0))
    ? "The latest successful odds request reported missing markets or failed sportsbooks."
    : null;

  const sources: ConsumerSourceHealth["sources"] = {
    schedule: assessConsumerSource({
      ...scheduleTimes,
      sourceTimestamp: aggregateDate(scheduleData?.sourceTimestamp),
      hasSource: Number(scheduleData?.count ?? 0) > 0,
      staleAfterMinutes: 60,
      now,
    }),
    injuries: assessConsumerSource({
      ...injuryTimes,
      sourceTimestamp: aggregateDate(injuryData?.sourceTimestamp),
      hasSource: Number(injuryData?.count ?? 0) > 0,
      staleAfterMinutes: staleAfterInjuryMinutes(now, upcomingGames.flatMap((game) => game.kickoffTime ? [game.kickoffTime] : [])),
      now,
    }),
    odds: assessConsumerSource({
      lastAttemptAt: latestOddsRequest?.requestedAt ?? null,
      lastAttemptStatus: latestOddsRequest?.status ?? null,
      lastSuccessAt: latestOddsSuccess?.requestedAt ?? null,
      sourceTimestamp: aggregateDate(oddsData?.sourceTimestamp ?? oddsData?.capturedAt),
      hasSource: Number(oddsData?.count ?? 0) > 0,
      staleAfterMinutes: 15,
      observationRequired: true,
      now,
      partialMessage: oddsPartialMessage,
    }),
    players: assessConsumerSource({
      ...playerTimes,
      sourceTimestamp: playerObservationAt(playerRuns, aggregateDate(playerData?.sourceTimestamp ?? playerData?.capturedAt)),
      hasSource: Number(playerData?.count ?? 0) > 0,
      staleAfterMinutes: sleeperStaleAfterMinutes(),
      observationRequired: true,
      now,
    }),
  };
  return { status: aggregateStatus(sources), sources };
}