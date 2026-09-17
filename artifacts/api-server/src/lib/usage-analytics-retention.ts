import { sql } from "drizzle-orm";
import {
  db,
  usageAnalyticsEventsTable,
  USAGE_ANALYTICS_RETENTION_DAYS,
} from "@workspace/db";
import { logger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = DAY_MS;
const DELETE_BATCH_SIZE = 1_000;

export type UsageAnalyticsRetentionResult = {
  deletedEvents: number;
  batches: number;
  cutoff: Date;
  retentionDays: number;
};

type UsageAnalyticsRetentionCleanup = () => Promise<UsageAnalyticsRetentionResult>;

export function usageAnalyticsRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - USAGE_ANALYTICS_RETENTION_DAYS * DAY_MS);
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
      .then((result) => {
        logger.info(
          {
            deletedEvents: result.deletedEvents,
            batches: result.batches,
            cutoff: result.cutoff.toISOString(),
            retentionDays: result.retentionDays,
          },
          "Usage Lab analytics retention cleanup completed",
        );
      })
      .catch((error) => {
        logger.error(
          { error, retentionDays: USAGE_ANALYTICS_RETENTION_DAYS },
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
