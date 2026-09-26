import test from "node:test";
import assert from "node:assert/strict";
import { db, playerRecoveryReceiptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RecoveryFeedLockedError, runAttestedPlayerRecovery } from "./player-feed-recovery";
import {
  listPlayerRecoveryReceipts, persistPlayerRecoveryReceipt,
  playerRecoveryReceiptCutoff, PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS,
} from "./player-recovery-receipts";

test("receipts remain available for 90 days, with an exclusive expiration boundary", () => {
  assert.equal(PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS, 90);
  assert.equal(
    playerRecoveryReceiptCutoff(new Date("2026-09-26T12:00:00.000Z")).toISOString(),
    "2026-06-28T12:00:00.000Z",
  );
});

test("a failed provider attempt is durably reviewable by receipt ID without raw errors", async () => {
  const receipt = await runAttestedPlayerRecovery({
    feeds: ["injuries"], database: "not-a-receipt-field", role: "not-a-receipt-field",
    systemId: "1234567890123", databaseOid: 1, serverAddress: "local", disposable: true,
  }, async () => { throw new RecoveryFeedLockedError("secret provider detail"); });
  try {
    await persistPlayerRecoveryReceipt(receipt);
    const found = await listPlayerRecoveryReceipts({ receiptId: receipt.receiptId, limit: 1 });
    assert.deepEqual(found, [receipt]);
    assert.equal(found[0]?.status, "failed");
    assert.deepEqual(found[0]?.attempts, [{ feed: "injuries", status: "failed", reason: "locked" }]);
    assert(!JSON.stringify(found).includes("secret provider detail"));
    await assert.rejects(persistPlayerRecoveryReceipt(receipt),
      (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23505");
    await assert.rejects(
      db.update(playerRecoveryReceiptsTable).set({ status: "success" })
        .where(eq(playerRecoveryReceiptsTable.receiptId, receipt.receiptId)),
      (error: unknown) => (error as { cause?: { message?: string } }).cause?.message?.includes("immutable") === true,
    );
  } finally {
    // Test fixtures are the only exception to append-only application writes.
    await db.delete(playerRecoveryReceiptsTable)
      .where(eq(playerRecoveryReceiptsTable.receiptId, receipt.receiptId));
  }
});