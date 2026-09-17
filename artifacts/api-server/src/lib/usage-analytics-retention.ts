import { sql } from "drizzle-orm";
import {
  db,
  usageAnalyticsEventsTable,
  usageAnalyticsRetentionTable,
  USAGE_ANALYTICS_RETENTION_DAYS,
} from "@workspace/db";
import { logger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = DAY_MS;
const DELETE_BATCH_SIZE = 1_000;

export const USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD = 3;
export type UsageAnalyticsRetentionStatus = "healthy" | "failed" | "pending";
export type UsageAnalyticsRetentionCleanupState = "pending" | "on_time" | "overdue";
export type UsageAnalyticsRetentionResult = {
  deletedEvents: number;
  batches: number;
  cutoff: Date;
  retentionDays: number;
};

export type UsageAnalyticsRetentionHealth = {
  retentionDays: number;
  cleanupIntervalHours: number;
  nextCleanupAt: Date | null;
  cleanupState: UsageAnalyticsRetentionCleanupState;
  status: UsageAnalyticsRetentionStatus;
  lastAttemptAt: Date | null;
  lastAttemptStatus: "success" | "failed" | null;
  consecutiveFailures: number;
  firstFailureAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastSuccessfulDeletedEvents: number | null;
  lastSuccessfulBatches: number | null;
  lastSuccessfulCutoff: Date | null;
  latestError: string | null;
  latestErrorAt: Date | null;
  alert: UsageAnalyticsRetentionAlert | null;
  workerOwned: true;
};

export type UsageAnalyticsRetentionAlert = {
  code: "repeated_failures";
  severity: "critical";
  scope: "usage-analytics-retention";
  title: "Usage Lab retention cleanup repeatedly failing";
  detail: string;
  consecutiveFailures: number;
  firstFailureAt: Date | null;
  latestFailureAt: Date | null;
  latestError: string | null;
};
type UsageAnalyticsRetentionCleanup = () => Promise<UsageAnalyticsRetentionResult>;

export function usageAnalyticsRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - USAGE_ANALYTICS_RETENTION_DAYS * DAY_MS);
}

export function usageAnalyticsRetentionNextCleanupAt(
  lastAttemptAt: Date | null,
  intervalMs = CLEANUP_INTERVAL_MS,
): Date | null {
  return lastAttemptAt ? new Date(lastAttemptAt.getTime() + intervalMs) : null;
}

export function usageAnalyticsRetentionCleanupState(
  nextCleanupAt: Date | null,
  now = new Date(),
): UsageAnalyticsRetentionCleanupState {
  if (!nextCleanupAt) return "pending";
  return nextCleanupAt.getTime() < now.getTime() ? "overdue" : "on_time";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createUsageAnalyticsRetentionAlert(input: {
  consecutiveFailures: number;
  firstFailureAt: Date | null;
  latestFailureAt: Date | null;
  latestError: string | null;
}): UsageAnalyticsRetentionAlert | null {
  if (input.consecutiveFailures < USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD) {
    return null;
  }
  return {
    code: "repeated_failures",
    severity: "critical",
    scope: "usage-analytics-retention",
    title: "Usage Lab retention cleanup repeatedly failing",
    detail: `Usage Lab retention cleanup has failed ${input.consecutiveFailures} consecutive times. Storage may exceed the ${USAGE_ANALYTICS_RETENTION_DAYS}-day retention policy until the worker recovers.`,
    consecutiveFailures: input.consecutiveFailures,
    firstFailureAt: input.firstFailureAt,
    latestFailureAt: input.latestFailureAt,
    latestError: input.latestError,
  };
}
/**
 * Delete expired rows in independent batches. PostgreSQL can interleave each
 * short delete with event inserts and report reads instead of holding a large
 * delete operation open for the whole history.
 */
export async function deleteExpiredUsageAnalyticsEvents(
  now = new Date(),
): Promise<UsageAnalyticsRetentionResult> {
  const cutoff = usageAnalyticsRetentionCutoff(now);
  let deletedEvents = 0;
  let batches = 0;

  while (true) {
    const deleted = await db.execute<{ id: number }>(sql`
      WITH expired AS (
        SELECT ${usageAnalyticsEventsTable.id} AS id
        FROM ${usageAnalyticsEventsTable}
        WHERE ${usageAnalyticsEventsTable.createdAt} < ${cutoff}
        ORDER BY ${usageAnalyticsEventsTable.createdAt}, ${usageAnalyticsEventsTable.id}
        LIMIT ${DELETE_BATCH_SIZE}
      )
      DELETE FROM ${usageAnalyticsEventsTable}
      WHERE ${usageAnalyticsEventsTable.id} IN (SELECT id FROM expired)
      RETURNING ${usageAnalyticsEventsTable.id} AS id
    `);
    const deletedInBatch = deleted.rows.length;
    deletedEvents += deletedInBatch;
    batches += 1;
    if (deletedInBatch < DELETE_BATCH_SIZE) break;
  }

  return {
    deletedEvents,
    batches,
    cutoff,
    retentionDays: USAGE_ANALYTICS_RETENTION_DAYS,
  };
}

/**
 * The persistent worker owns this maintenance. A failed cleanup is logged and
 * retried on the next daily tick; it never rejects the worker or capture path.
 */
export function startUsageAnalyticsRetention(options: {
  cleanup?: UsageAnalyticsRetentionCleanup;
  intervalMs?: number;
} = {}) {
  const cleanup = options.cleanup ?? deleteExpiredUsageAnalyticsEvents;
  const intervalMs = options.intervalMs ?? CLEANUP_INTERVAL_MS;
  let cleanupInFlight: Promise<void> | null = null;

  const runCleanup = () => {
    if (cleanupInFlight) return cleanupInFlight;
    cleanupInFlight = cleanup()
      .then(async (result) => {
        const completedAt = new Date();
        try {
          await recordSuccessfulRetentionCleanup(result, completedAt);
        } catch (stateError) {
          logger.error(
            { stateError, retentionDays: USAGE_ANALYTICS_RETENTION_DAYS },
            "Usage Lab analytics retention success state could not be persisted",
          );
        }
        logger.info(
          {
            deletedEvents: result.deletedEvents,
            batches: result.batches,
            cutoff: result.cutoff.toISOString(),
            retentionDays: result.retentionDays,
            completedAt: completedAt.toISOString(),
          },
          "Usage Lab analytics retention cleanup completed",
        );
      })
      .catch(async (error) => {
        const attemptedAt = new Date();
        try {
          await recordFailedRetentionCleanup(error, attemptedAt);
        } catch (stateError) {
          logger.error(
            { error, stateError, retentionDays: USAGE_ANALYTICS_RETENTION_DAYS },
            "Usage Lab analytics retention cleanup state could not be persisted",
          );
        }
        logger.error(
          {
            error,
            attemptedAt: attemptedAt.toISOString(),
            retentionDays: USAGE_ANALYTICS_RETENTION_DAYS,
          },
          "Usage Lab analytics retention cleanup failed",
        );
      })
      .finally(() => {
        cleanupInFlight = null;
      });
    return cleanupInFlight;
  };

  void runCleanup();
  const timer = setInterval(() => {
    void runCleanup();
  }, intervalMs);
  timer.unref?.();
  logger.info(
    {
      intervalHours: intervalMs / (60 * 60 * 1000),
      retentionDays: USAGE_ANALYTICS_RETENTION_DAYS,
    },
    "Usage Lab analytics retention maintenance started in the persistent worker",
  );
  return () => clearInterval(timer);
}
async function recordFailedRetentionCleanup(error: unknown, attemptedAt: Date) {
  const latestError = errorMessage(error);
  await db
    .insert(usageAnalyticsRetentionTable)
    .values({
      id: 1,
      lastAttemptAt: attemptedAt,
      lastAttemptStatus: "failed",
      consecutiveFailures: 1,
      firstFailureAt: attemptedAt,
      latestError,
      latestErrorAt: attemptedAt,
    })
    .onConflictDoUpdate({
      target: usageAnalyticsRetentionTable.id,
      set: {
        lastAttemptAt: attemptedAt,
        lastAttemptStatus: "failed",
        consecutiveFailures: sql`${usageAnalyticsRetentionTable.consecutiveFailures} + 1`,
        firstFailureAt: sql`COALESCE(${usageAnalyticsRetentionTable.firstFailureAt}, ${attemptedAt})`,
        latestError,
        latestErrorAt: attemptedAt,
      },
    });
}

export async function getUsageAnalyticsRetentionHealth(): Promise<UsageAnalyticsRetentionHealth> {
  const [record] = await db
    .select()
    .from(usageAnalyticsRetentionTable)
    .where(sql`${usageAnalyticsRetentionTable.id} = 1`)
    .limit(1);
  const lastAttemptStatus = record?.lastAttemptStatus === "success" || record?.lastAttemptStatus === "failed"
    ? record.lastAttemptStatus
    : null;
  const consecutiveFailures = record?.consecutiveFailures ?? 0;
  const nextCleanupAt = usageAnalyticsRetentionNextCleanupAt(record?.lastAttemptAt ?? null);

  return {
    retentionDays: USAGE_ANALYTICS_RETENTION_DAYS,
    cleanupIntervalHours: CLEANUP_INTERVAL_MS / (60 * 60 * 1000),
    nextCleanupAt,
    cleanupState: usageAnalyticsRetentionCleanupState(nextCleanupAt),
    status: lastAttemptStatus === "success"
      ? "healthy"
      : lastAttemptStatus === "failed"
        ? "failed"
        : "pending",
    lastAttemptAt: record?.lastAttemptAt ?? null,
    lastAttemptStatus,
    consecutiveFailures,
    firstFailureAt: record?.firstFailureAt ?? null,
    lastSuccessfulAt: record?.lastSuccessfulAt ?? null,
    lastSuccessfulDeletedEvents: record?.lastSuccessfulDeletedEvents ?? null,
    lastSuccessfulBatches: record?.lastSuccessfulBatches ?? null,
    lastSuccessfulCutoff: record?.lastSuccessfulCutoff ?? null,
    latestError: record?.latestError ?? null,
    latestErrorAt: record?.latestErrorAt ?? null,
    alert: lastAttemptStatus === "failed"
      ? createUsageAnalyticsRetentionAlert({
        consecutiveFailures,
        firstFailureAt: record?.firstFailureAt ?? null,
        latestFailureAt: record?.latestErrorAt ?? null,
        latestError: record?.latestError ?? null,
      })
      : null,
    workerOwned: true,
  };
}

async function recordSuccessfulRetentionCleanup(result: UsageAnalyticsRetentionResult, completedAt: Date) {
  await db
    .insert(usageAnalyticsRetentionTable)
    .values({
      id: 1,
      lastAttemptAt: completedAt,
      lastAttemptStatus: "success",
      consecutiveFailures: 0,
      firstFailureAt: null,
      lastSuccessfulAt: completedAt,
      lastSuccessfulDeletedEvents: result.deletedEvents,
      lastSuccessfulBatches: result.batches,
      lastSuccessfulCutoff: result.cutoff,
    })
    .onConflictDoUpdate({
      target: usageAnalyticsRetentionTable.id,
      set: {
        lastAttemptAt: completedAt,
        lastAttemptStatus: "success",
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastSuccessfulAt: completedAt,
        lastSuccessfulDeletedEvents: result.deletedEvents,
        lastSuccessfulBatches: result.batches,
        lastSuccessfulCutoff: result.cutoff,
      },
    });
}
