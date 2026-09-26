import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, playerRecoveryReceiptsTable, playerRecoveryReceiptCleanupTable } from "@workspace/db";
import type { runAttestedPlayerRecovery } from "./player-feed-recovery";
import { logger } from "./logger";

export type PlayerRecoveryReceipt = Awaited<ReturnType<typeof runAttestedPlayerRecovery>>;
export const PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;
export const PLAYER_RECOVERY_CLEANUP_FAILURE_THRESHOLD = 3;
export const PLAYER_RECOVERY_CLEANUP_FIRST_ATTEMPT_GRACE_MS = DAY_MS;

export function playerRecoveryCleanupNeverStartedAlert(firstObservedAt: Date, now: Date) {
  const elapsed = now.getTime() - firstObservedAt.getTime();
  return Number.isFinite(elapsed) && elapsed >= PLAYER_RECOVERY_CLEANUP_FIRST_ATTEMPT_GRACE_MS
    ? {
        code: "never_started" as const,
        severity: "critical" as const,
        scope: "player-recovery-receipt-cleanup" as const,
        title: "Player refresh receipt cleanup has not started",
        detail: "No cleanup attempt was recorded within 24 hours of the cleanup health marker. Check that the persistent worker is running and approved.",
      }
    : null;
}

export function playerRecoveryCleanupAlert(consecutiveFailures: number) {
  return consecutiveFailures >= PLAYER_RECOVERY_CLEANUP_FAILURE_THRESHOLD
    ? {
        code: "repeated_failures" as const,
        severity: "critical" as const,
        scope: "player-recovery-receipt-cleanup" as const,
        title: "Player refresh receipt cleanup repeatedly failing",
        detail: `Receipt cleanup has failed ${consecutiveFailures} consecutive times. Expired receipts may remain beyond the ${PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS}-day retention period.`,
      }
    : null;
}

/** Run before the API listens, whether Publish provisioned the table or SQL migrations did. */
export async function ensurePlayerRecoveryReceiptCleanupMarker() {
  await db.insert(playerRecoveryReceiptCleanupTable).values({ id: 1 }).onConflictDoNothing();
  // Fail startup if Publish created an incomplete table rather than silently
  // starting an unmeasurable grace period on a later admin health request.
  const [marker] = await db.select({ firstObservedAt: playerRecoveryReceiptCleanupTable.firstObservedAt })
    .from(playerRecoveryReceiptCleanupTable)
    .where(eq(playerRecoveryReceiptCleanupTable.id, 1)).limit(1);
  if (!marker?.firstObservedAt) throw new Error("Receipt cleanup health marker is not ready");
}

export async function getPlayerRecoveryReceiptCleanupHealth(now = new Date()) {
  const [row] = await db.select().from(playerRecoveryReceiptCleanupTable)
    .where(eq(playerRecoveryReceiptCleanupTable.id, 1)).limit(1);
  if (!row) throw new Error("Receipt cleanup health marker could not be read");
  const lastAttemptStatus = row?.lastAttemptStatus === "success" || row?.lastAttemptStatus === "failed"
    ? row.lastAttemptStatus : null;
  const nextCleanupAt = row?.lastAttemptAt
    ? new Date(row.lastAttemptAt.getTime() + DAY_MS) : null;
  return {
    retentionDays: PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS,
    cleanupIntervalHours: 24,
    status: lastAttemptStatus === "success" ? "healthy" as const
      : lastAttemptStatus === "failed" ? "failed" as const : "pending" as const,
    cleanupState: nextCleanupAt === null ? "pending" as const
      : nextCleanupAt.getTime() < now.getTime() ? "overdue" as const : "on_time" as const,
    firstObservedAt: row.firstObservedAt,
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastAttemptStatus,
    nextCleanupAt,
    consecutiveFailures: row?.consecutiveFailures ?? 0,
    firstFailureAt: row?.firstFailureAt ?? null,
    lastSuccessfulAt: row?.lastSuccessfulAt ?? null,
    lastSuccessfulDeletedReceipts: row?.lastSuccessfulDeletedReceipts ?? null,
    alert: lastAttemptStatus === "failed"
      ? playerRecoveryCleanupAlert(row.consecutiveFailures)
      : lastAttemptStatus === null
        ? playerRecoveryCleanupNeverStartedAlert(row.firstObservedAt, now) : null,
    workerOwned: true as const,
  };
}

async function recordCleanupSuccess(deleted: number, attemptedAt: Date) {
  await db.insert(playerRecoveryReceiptCleanupTable).values({
    id: 1, lastAttemptAt: attemptedAt, lastAttemptStatus: "success",
    consecutiveFailures: 0, firstFailureAt: null,
    lastSuccessfulAt: attemptedAt, lastSuccessfulDeletedReceipts: deleted,
  }).onConflictDoUpdate({
    target: playerRecoveryReceiptCleanupTable.id,
    set: {
      lastAttemptAt: attemptedAt, lastAttemptStatus: "success",
      consecutiveFailures: 0, firstFailureAt: null,
      lastSuccessfulAt: attemptedAt, lastSuccessfulDeletedReceipts: deleted,
    },
  });
}

async function recordCleanupFailure(attemptedAt: Date) {
  await db.insert(playerRecoveryReceiptCleanupTable).values({
    id: 1, lastAttemptAt: attemptedAt, lastAttemptStatus: "failed",
    consecutiveFailures: 1, firstFailureAt: attemptedAt,
  }).onConflictDoUpdate({
    target: playerRecoveryReceiptCleanupTable.id,
    set: {
      lastAttemptAt: attemptedAt, lastAttemptStatus: "failed",
      consecutiveFailures: sql`${playerRecoveryReceiptCleanupTable.consecutiveFailures} + 1`,
      firstFailureAt: sql`COALESCE(${playerRecoveryReceiptCleanupTable.firstFailureAt}, ${attemptedAt})`,
    },
  });
}

export async function persistPlayerRecoveryReceipt(receipt: PlayerRecoveryReceipt) {
  // An insert-only write: a receipt is never revised when provider rows change.
  await db.insert(playerRecoveryReceiptsTable).values({
    receiptId: receipt.receiptId,
    event: receipt.event,
    approvedFeeds: receipt.approvedFeeds,
    target: receipt.target,
    syncRunJobKey: receipt.syncRunJobKey,
    startedAt: new Date(receipt.startedAt),
    completedAt: new Date(receipt.completedAt),
    status: receipt.status,
    attempts: receipt.attempts,
  });
}

export async function listPlayerRecoveryReceipts(options: { receiptId?: string; limit: number }) {
  const rows = await db.select().from(playerRecoveryReceiptsTable)
    .where(and(
      gte(playerRecoveryReceiptsTable.completedAt, playerRecoveryReceiptCutoff()),
      options.receiptId ? eq(playerRecoveryReceiptsTable.receiptId, options.receiptId) : undefined,
    ))
    .orderBy(desc(playerRecoveryReceiptsTable.completedAt), desc(playerRecoveryReceiptsTable.receiptId))
    .limit(options.limit);
  return rows.map((row): PlayerRecoveryReceipt => ({
    event: "player_recovery_receipt",
    receiptId: row.receiptId as PlayerRecoveryReceipt["receiptId"],
    approvedFeeds: row.approvedFeeds,
    target: row.target as PlayerRecoveryReceipt["target"],
    syncRunJobKey: row.syncRunJobKey,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    status: row.status as PlayerRecoveryReceipt["status"],
    attempts: row.attempts,
  }));
}

export function playerRecoveryReceiptCutoff(now = new Date()) {
  return new Date(now.getTime() - PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS * DAY_MS);
}

export async function deleteExpiredPlayerRecoveryReceipts(now = new Date()) {
  const cutoff = playerRecoveryReceiptCutoff(now);
  let deleted = 0;
  while (true) {
    const result = await db.execute<{ receipt_id: string }>(sql`
      WITH expired AS (
        SELECT ${playerRecoveryReceiptsTable.receiptId}
        FROM ${playerRecoveryReceiptsTable}
        WHERE ${playerRecoveryReceiptsTable.completedAt} < ${cutoff}
        ORDER BY ${playerRecoveryReceiptsTable.completedAt}
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM ${playerRecoveryReceiptsTable}
      WHERE ${playerRecoveryReceiptsTable.receiptId} IN (SELECT receipt_id FROM expired)
      RETURNING ${playerRecoveryReceiptsTable.receiptId}
    `);
    deleted += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }
  return deleted;
}

/** Persistent worker owns daily cleanup, including a first pass at startup. */
export function startPlayerRecoveryReceiptRetention(options: {
  cleanup?: () => Promise<number>;
  intervalMs?: number;
} = {}) {
  let inFlight = false;
  const deleteExpired = options.cleanup ?? deleteExpiredPlayerRecoveryReceipts;
  const cleanup = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const deleted = await deleteExpired();
      try {
        await recordCleanupSuccess(deleted, new Date());
      } catch {
        logger.error("Player recovery receipt cleanup success state could not be persisted");
      }
      logger.info({ deleted, retentionDays: PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS }, "Player recovery receipt retention completed");
    } catch {
      try {
        await recordCleanupFailure(new Date());
      } catch {
        logger.error("Player recovery receipt cleanup failure state could not be persisted");
      }
      logger.error("Player recovery receipt retention failed; will retry on next tick");
    } finally {
      inFlight = false;
    }
  };
  void cleanup();
  const timer = setInterval(() => { void cleanup(); }, options.intervalMs ?? DAY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}