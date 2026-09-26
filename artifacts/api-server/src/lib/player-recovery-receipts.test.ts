import test from "node:test";
import assert from "node:assert/strict";
import { db, pool, playerRecoveryReceiptsTable, playerRecoveryReceiptCleanupTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RecoveryFeedLockedError, runAttestedPlayerRecovery } from "./player-feed-recovery";
import dataSyncRouter from "../routes/data-sync";
import { requireAdmin } from "../middlewares/admin";
import {
  listPlayerRecoveryReceipts, persistPlayerRecoveryReceipt,
  playerRecoveryReceiptCutoff, PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS,
  getPlayerRecoveryReceiptCleanupHealth, playerRecoveryCleanupAlert,
  playerRecoveryCleanupNeverStartedAlert, ensurePlayerRecoveryReceiptCleanupMarker,
  startPlayerRecoveryReceiptRetention,
} from "./player-recovery-receipts";

test("the restricted alert is thresholded and never incorporates error text", () => {
  const healthRoute = (dataSyncRouter as unknown as { stack: Array<{
    route?: { path: string; stack: Array<{ handle: unknown }> };
  }> }).stack.find((layer) => layer.route?.path === "/admin/player-recovery/cleanup-health")?.route;
  assert.equal(healthRoute?.stack[0]?.handle, requireAdmin);
  assert.equal(playerRecoveryCleanupAlert(2), null);
  assert.deepEqual(playerRecoveryCleanupAlert(3), {
    code: "repeated_failures", severity: "critical",
    scope: "player-recovery-receipt-cleanup",
    title: "Player refresh receipt cleanup repeatedly failing",
    detail: "Receipt cleanup has failed 3 consecutive times. Expired receipts may remain beyond the 90-day retention period.",
  });
});

test("first attempt gets a 24-hour grace period before the worker warning", () => {
  const observed = new Date("2026-09-26T00:00:00.000Z");
  assert.equal(playerRecoveryCleanupNeverStartedAlert(observed, new Date(observed.getTime() + 86_399_999)), null);
  assert.equal(playerRecoveryCleanupNeverStartedAlert(observed, new Date(observed.getTime() - 1)), null);
  assert.deepEqual(playerRecoveryCleanupNeverStartedAlert(observed, new Date(observed.getTime() + 86_400_000)), {
    code: "never_started", severity: "critical",
    scope: "player-recovery-receipt-cleanup",
    title: "Player refresh receipt cleanup has not started",
    detail: "No cleanup attempt was recorded within 24 hours of the cleanup health marker. Check that the persistent worker is running and approved.",
  });
});

test("API startup seeds a schema-first install with no row before the first admin visit", async () => {
  const client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", ["player-recovery-cleanup-test"]);
  const [original] = await db.select().from(playerRecoveryReceiptCleanupTable).limit(1);
  try {
    await db.delete(playerRecoveryReceiptCleanupTable);
    await ensurePlayerRecoveryReceiptCleanupMarker();
    const first = await getPlayerRecoveryReceiptCleanupHealth(new Date());
    assert.equal(first.status, "pending");
    assert.equal(first.alert, null);
    await ensurePlayerRecoveryReceiptCleanupMarker();
    const overdue = await getPlayerRecoveryReceiptCleanupHealth(
      new Date(first.firstObservedAt.getTime() + 86_400_000),
    );
    assert.equal(overdue.alert?.code, "never_started");
    assert.equal(overdue.cleanupState, "pending");
    assert.equal(overdue.firstObservedAt.getTime(), first.firstObservedAt.getTime());
    assert(!JSON.stringify(overdue).includes("DATABASE_URL"));
  } finally {
    await db.delete(playerRecoveryReceiptCleanupTable);
    if (original) await db.insert(playerRecoveryReceiptCleanupTable).values(original);
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["player-recovery-cleanup-test"]);
    client.release();
  }
});

test("worker cleanup persists repeated failures, clears the alert on success, and retains no error details", async () => {
  const client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", ["player-recovery-cleanup-test"]);
  const [original] = await db.select().from(playerRecoveryReceiptCleanupTable).limit(1);
  let shouldFail = true;
  let attempts = 0;
  let stop: (() => void) | undefined;
  try {
    await db.delete(playerRecoveryReceiptCleanupTable);
    await ensurePlayerRecoveryReceiptCleanupMarker();
    stop = startPlayerRecoveryReceiptRetention({
      intervalMs: 25,
      cleanup: async () => {
        attempts++;
        if (shouldFail) throw new Error("secret database identity and provider URL");
        return 4;
      },
    });
    const waitFor = async (predicate: () => Promise<boolean>) => {
      for (let i = 0; i < 100; i++) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("Cleanup state did not reach the expected condition");
    };
    await waitFor(async () => (await getPlayerRecoveryReceiptCleanupHealth()).consecutiveFailures >= 3);
    const failed = await getPlayerRecoveryReceiptCleanupHealth();
    assert.equal(failed.status, "failed");
    assert.equal(failed.alert?.code, "repeated_failures");
    assert(failed.firstFailureAt instanceof Date);
    assert(!JSON.stringify(failed).includes("secret"));
    const [stored] = await db.select().from(playerRecoveryReceiptCleanupTable);
    assert(!JSON.stringify(stored).includes("secret"));
    shouldFail = false;
    await waitFor(async () => (await getPlayerRecoveryReceiptCleanupHealth()).status === "healthy");
    const recovered = await getPlayerRecoveryReceiptCleanupHealth();
    assert.equal(recovered.alert, null);
    assert.equal(recovered.consecutiveFailures, 0);
    assert.equal(recovered.firstFailureAt, null);
    assert.equal(recovered.lastSuccessfulDeletedReceipts, 4);
    assert(attempts >= 4);
  } finally {
    stop?.();
    await db.delete(playerRecoveryReceiptCleanupTable);
    if (original) await db.insert(playerRecoveryReceiptCleanupTable).values(original);
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["player-recovery-cleanup-test"]);
    client.release();
  }
});

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