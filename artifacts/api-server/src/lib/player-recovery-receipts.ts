import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, playerRecoveryReceiptsTable } from "@workspace/db";
import type { runAttestedPlayerRecovery } from "./player-feed-recovery";
import { logger } from "./logger";

export type PlayerRecoveryReceipt = Awaited<ReturnType<typeof runAttestedPlayerRecovery>>;
export const PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

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
export function startPlayerRecoveryReceiptRetention() {
  let inFlight = false;
  const cleanup = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const deleted = await deleteExpiredPlayerRecoveryReceipts();
      logger.info({ deleted, retentionDays: PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS }, "Player recovery receipt retention completed");
    } catch {
      logger.error("Player recovery receipt retention failed; will retry on next tick");
    } finally {
      inFlight = false;
    }
  };
  void cleanup();
  const timer = setInterval(() => { void cleanup(); }, DAY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}