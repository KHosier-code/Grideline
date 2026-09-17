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

export type UsageAnalyticsRetentionStatus = "healthy" | "failed" | "pending";
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
  status: UsageAnalyticsRetentionStatus;
  lastAttemptAt: Date | null;
  lastAttemptStatus: "success" | "failed" | null;
  lastSuccessfulAt: Date | null;
  lastSuccessfulDeletedEvents: number | null;
  lastSuccessfulBatches: number | null;
  lastSuccessfulCutoff: Date | null;
  latestError: string | null;
  latestErrorAt: Date | null;
  workerOwned: true;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
      latestError,
      latestErrorAt: attemptedAt,
    })
    .onConflictDoUpdate({
      target: usageAnalyticsRetentionTable.id,
      set: {
        lastAttemptAt: attemptedAt,
        lastAttemptStatus: "failed",
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

  return {
    retentionDays: USAGE_ANALYTICS_RETENTION_DAYS,
    cleanupIntervalHours: CLEANUP_INTERVAL_MS / (60 * 60 * 1000),
    nextCleanupAt: usageAnalyticsRetentionNextCleanupAt(record?.lastAttemptAt ?? null),
    status: lastAttemptStatus === "success"
      ? "healthy"
      : lastAttemptStatus === "failed"
        ? "failed"
        : "pending",
    lastAttemptAt: record?.lastAttemptAt ?? null,
    lastAttemptStatus,
    lastSuccessfulAt: record?.lastSuccessfulAt ?? null,
    lastSuccessfulDeletedEvents: record?.lastSuccessfulDeletedEvents ?? null,
    lastSuccessfulBatches: record?.lastSuccessfulBatches ?? null,
    lastSuccessfulCutoff: record?.lastSuccessfulCutoff ?? null,
    latestError: record?.latestError ?? null,
    latestErrorAt: record?.latestErrorAt ?? null,
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
        lastSuccessfulAt: completedAt,
        lastSuccessfulDeletedEvents: result.deletedEvents,
        lastSuccessfulBatches: result.batches,
        lastSuccessfulCutoff: result.cutoff,
      },
    });
}
