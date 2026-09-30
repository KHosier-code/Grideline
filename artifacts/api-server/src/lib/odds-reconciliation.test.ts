import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, oddsApiRequestsTable, oddsRequestResolutionsTable } from "@workspace/db";
import { admitPaidRequest, getOddsSchedulingBalance, reconcileOddsRequest } from "./odds";

test("disposable database: an unknown outcome blocks automatic capture until it is reconciled", async () => {
  assert.equal(process.env.GRIDLINE_DISPOSABLE_ODDS_TEST, "1", "This test must never use a shared database.");
  const now = new Date();
  const intent = (label: string, extra: Partial<Parameters<typeof admitPaidRequest>[0]> = {}) => admitPaidRequest({
    intentKey: `${label}-${randomUUID()}`, requestedAt: now, metadata: {}, expectedRequestCost: 3, ...extra,
  });
  // A request still in flight (or one that never got an answer) may have been billed.
  const [prior] = await db.insert(oddsApiRequestsTable).values({
    intentKey: `test-prior-${randomUUID()}`, requestedAt: new Date(now.getTime() - 60_000),
    status: "running",
  }).returning();
  assert.equal(await getOddsSchedulingBalance(), null);
  assert.equal((await intent("while-unknown")).skipped, true);

  // An operator who accepts the risk gets exactly one logged call.
  const riskInput = {
    intentKey: `operator-one-time:${randomUUID()}`, requestedAt: new Date(now.getTime() - 10_000),
    metadata: {}, expectedRequestCost: 3,
    riskApproval: {
      blockedRequestId: prior.id, maxCredits: 3, verifiedRemaining: 30,
      verifiedAt: new Date(now.getTime() - 11_000), approvedBy: "test-operator",
    },
  };
  assert.equal((await admitPaidRequest({ ...riskInput, intentKey: `unauthorized-${randomUUID()}` })).skipped, true);
  const risk = await admitPaidRequest(riskInput);
  assert.equal(risk.admitted, true);
  const [riskRow] = await db.select().from(oddsApiRequestsTable).where(eq(oddsApiRequestsTable.id, risk.requestId));
  assert.equal(riskRow?.metadata?.riskOverrideForRequestId, prior.id);
  await db.update(oddsApiRequestsTable).set({ status: "success", creditsRemaining: 27 })
    .where(eq(oddsApiRequestsTable.id, risk.requestId));
  assert.equal((await intent("after-risk")).skipped, true, "one approved call does not clear the unknown request");

  // Provider evidence settles the unknown request; automatic capture resumes.
  const evidence = {
    requestId: prior.id, providerOutcome: "failed" as const, billedCredits: 3,
    verifiedRemaining: 27, evidenceReference: "provider-support-receipt-123",
    evidenceCheckedAt: now, approvedBy: "test-operator",
  };
  const resolutionId = await reconcileOddsRequest(evidence);
  await assert.rejects(reconcileOddsRequest(evidence));
  await assert.rejects(db.update(oddsRequestResolutionsTable).set({ billedCredits: 0 })
    .where(eq(oddsRequestResolutionsTable.id, resolutionId)));
  const resumed = await intent("after-reconcile");
  assert.equal(resumed.admitted, true);
  assert.equal(resumed.creditsRemaining, 27);
  // An intent key is admitted at most once.
  const replay = await admitPaidRequest({ intentKey: `replay-${resumed.requestId}`, requestedAt: now, metadata: {}, expectedRequestCost: 3 });
  assert.equal((await admitPaidRequest({ intentKey: `replay-${resumed.requestId}`, requestedAt: now, metadata: {}, expectedRequestCost: 3 })).skipped, true);
  for (const row of [resumed, replay]) {
    await db.update(oddsApiRequestsTable).set({ status: "success", creditsRemaining: 24 })
      .where(eq(oddsApiRequestsTable.id, row.requestId));
  }
  const [stillRunning] = await db.select().from(oddsApiRequestsTable).where(eq(oddsApiRequestsTable.id, prior.id));
  assert.equal(stillRunning?.status, "running", "reconciliation records evidence without rewriting the request");
});

test("disposable database: a rejected or long-stale request does not block automatic odds capture", async () => {
  assert.equal(process.env.GRIDLINE_DISPOSABLE_ODDS_TEST, "1", "This test must never use a shared database.");
  const now = new Date();
  const intent = (label: string) => admitPaidRequest({
    intentKey: `${label}-${randomUUID()}`, requestedAt: now, metadata: {}, expectedRequestCost: 3,
  });
  // The provider answered (for example a rejected key): a known, unbilled outcome.
  const [rejected] = await db.insert(oddsApiRequestsTable).values({
    intentKey: `test-rejected-${randomUUID()}`, requestedAt: new Date(now.getTime() - 5_000),
    status: "failed", httpStatus: 401, creditsRemaining: null,
  }).returning();
  const afterRejected = await intent("after-rejected");
  assert.equal(afterRejected.admitted, true);
  await db.update(oddsApiRequestsTable).set({ status: "success", creditsRemaining: 400 })
    .where(eq(oddsApiRequestsTable.id, afterRejected.requestId));
  // No HTTP answer at all: billing is unknown, so capture waits.
  const [timedOut] = await db.insert(oddsApiRequestsTable).values({
    intentKey: `test-timeout-${randomUUID()}`, requestedAt: new Date(now.getTime() - 2_000),
    status: "failed", httpStatus: null, creditsRemaining: null,
  }).returning();
  assert.equal((await intent("after-timeout")).skipped, true);
  // An in-flight row from a process that died over an hour ago no longer blocks.
  await db.update(oddsApiRequestsTable).set({ status: "running", requestedAt: new Date(now.getTime() - 2 * 3_600_000) })
    .where(eq(oddsApiRequestsTable.id, timedOut.id));
  assert.equal((await intent("after-stale")).admitted, true);
  assert.ok(rejected.id);
});
