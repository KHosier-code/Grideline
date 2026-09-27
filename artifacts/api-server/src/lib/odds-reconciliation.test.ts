import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, oddsApiRequestsTable, oddsRequestResolutionsTable, oddsSpendApprovalsTable, schedulerJobsTable } from "@workspace/db";
import { admitPaidRequest, approveNextOddsSpend, getOddsSchedulingBalance, reconcileOddsRequest } from "./odds";

test("disposable database: provider evidence and exact budget approval precede one future scheduled admission", async () => {
  assert.equal(process.env.GRIDLINE_DISPOSABLE_ODDS_TEST, "1", "This test must never use a shared database.");
  const now = new Date();
  const scheduledFor = new Date(now.getTime() + 120_000);
  const jobKey = "odds-adaptive";
  const intentKey = `${jobKey}:${scheduledFor.toISOString()}`;
  const [prior] = await db.insert(oddsApiRequestsTable).values({
    intentKey: `test-prior-${randomUUID()}`, requestedAt: new Date(now.getTime() - 60_000),
    status: "running",
  }).returning();
  await db.insert(schedulerJobsTable).values({
    jobKey, provider: "odds-api", kind: "odds-adaptive",
    cadence: "test", enabled: true, nextRunAt: scheduledFor,
  });
  const nextAt = new Date(scheduledFor.getTime() + 1000);
  const tryIntent = (key = intentKey, requestedAt = nextAt) => admitPaidRequest({
    intentKey: key, requestedAt, metadata: { jobKey, scheduledFor: scheduledFor.toISOString() },
    expectedRequestCost: 3,
  });
  assert.equal(await getOddsSchedulingBalance(), null);
  const before = await tryIntent(`before-${randomUUID()}`);
  assert.equal(before.skipped, true);
  const evidence = {
    requestId: prior.id, providerOutcome: "failed" as const, billedCredits: 3,
    verifiedRemaining: 30, evidenceReference: "provider-support-receipt-123",
    evidenceCheckedAt: now, approvedBy: "test-operator",
  };
  const resolutionId = await reconcileOddsRequest(evidence);
  await assert.rejects(reconcileOddsRequest(evidence));
  assert.equal(await getOddsSchedulingBalance(), 30);
  // An old process writing a late success must not silently remove the gate.
  await db.update(oddsApiRequestsTable).set({ status: "success", creditsRemaining: 29 })
    .where(eq(oddsApiRequestsTable.id, prior.id));
  assert.equal((await tryIntent(`late-${randomUUID()}`)).skipped, true);
  await db.update(oddsApiRequestsTable).set({ status: "running", creditsRemaining: null })
    .where(eq(oddsApiRequestsTable.id, prior.id));
  const unapproved = await tryIntent(`unapproved-${randomUUID()}`);
  assert.equal(unapproved.skipped, true);
  await assert.rejects(approveNextOddsSpend({
    requestId: prior.id, intentKey, maxCredits: 31,
    approvedBy: "test-operator", approvalReference: "budget-approval-123",
  }));
  const approvalId = await approveNextOddsSpend({
    requestId: prior.id, intentKey, maxCredits: 3,
    approvedBy: "test-operator", approvalReference: "budget-approval-123",
  });
  const admitted = await tryIntent();
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.creditsRemaining, 30);
  const [approval] = await db.select().from(oddsSpendApprovalsTable).where(eq(oddsSpendApprovalsTable.id, approvalId));
  const [request] = await db.select().from(oddsApiRequestsTable).where(eq(oddsApiRequestsTable.id, admitted.requestId));
  const [resolution] = await db.select().from(oddsRequestResolutionsTable).where(eq(oddsRequestResolutionsTable.id, resolutionId));
  assert.equal(approval?.consumedByRequestId, admitted.requestId);
  assert.equal(request?.metadata?.spendApprovalId, approvalId);
  assert.equal(resolution?.providerOutcome, "failed");
  const [unchangedPrior] = await db.select().from(oddsApiRequestsTable).where(eq(oddsApiRequestsTable.id, prior.id));
  assert.equal(unchangedPrior?.status, "running");
  assert.equal((await tryIntent()).skipped, true);
  assert.equal((await tryIntent(`${jobKey}:${new Date(scheduledFor.getTime() + 60_000).toISOString()}`)).skipped, true);
  await assert.rejects(db.update(oddsRequestResolutionsTable).set({ billedCredits: 0 })
    .where(eq(oddsRequestResolutionsTable.id, resolutionId)));

  // Explicit risk acceptance buys precisely one logged call, not permission
  // for the scheduler to keep charging while its older admission is unknown.
  await db.update(oddsApiRequestsTable).set({
    status: "success", creditsRemaining: 28, requestedAt: new Date(now.getTime() - 40_000),
  }).where(eq(oddsApiRequestsTable.id, admitted.requestId));
  const secondScheduled = new Date(now.getTime() + 180_000);
  const secondIntent = `${jobKey}:${secondScheduled.toISOString()}`;
  await db.update(schedulerJobsTable).set({ nextRunAt: secondScheduled })
    .where(eq(schedulerJobsTable.jobKey, jobKey));
  assert.equal((await admitPaidRequest({
    intentKey: secondIntent, requestedAt: new Date(secondScheduled.getTime() + 1000),
    expectedRequestCost: 3, metadata: { jobKey, scheduledFor: secondScheduled.toISOString() },
  })).skipped, true, "success of the first approved capture never re-enables automatic paid calls");
  await assert.rejects(approveNextOddsSpend({
    requestId: prior.id, intentKey: `odds-adaptive:${new Date(secondScheduled.getTime() + 1000).toISOString()}`,
    maxCredits: 3, approvedBy: "test-operator", approvalReference: "second-budget-approval-123",
  }));
  // The skipped intent is durable and cannot be replayed. Move to a fresh
  // future occurrence for the separate, explicitly budgeted second request.
  const approvedSecondScheduled = new Date(secondScheduled.getTime() + 60_000);
  const approvedSecondIntent = `${jobKey}:${approvedSecondScheduled.toISOString()}`;
  await db.update(schedulerJobsTable).set({ nextRunAt: approvedSecondScheduled })
    .where(eq(schedulerJobsTable.jobKey, jobKey));
  await approveNextOddsSpend({
    requestId: prior.id, intentKey: approvedSecondIntent,
    maxCredits: 3, approvedBy: "test-operator", approvalReference: "second-budget-approval-123",
  });
  const second = await admitPaidRequest({
    intentKey: approvedSecondIntent, requestedAt: new Date(approvedSecondScheduled.getTime() + 1000),
    expectedRequestCost: 3, metadata: { jobKey, scheduledFor: approvedSecondScheduled.toISOString() },
  });
  assert.equal(second.admitted, true);
  await db.update(oddsApiRequestsTable).set({
    status: "success", creditsRemaining: 25, requestedAt: new Date(now.getTime() - 30_000),
  }).where(eq(oddsApiRequestsTable.id, second.requestId));
  const [stuck] = await db.insert(oddsApiRequestsTable).values({
    intentKey: `test-stuck-${randomUUID()}`, requestedAt: new Date(now.getTime() - 20_000),
    status: "running",
  }).returning();
  const riskAt = new Date(now.getTime() - 10_000);
  const riskInput = {
    intentKey: `operator-one-time:${randomUUID()}`, requestedAt: riskAt,
    metadata: {}, expectedRequestCost: 3,
    riskApproval: {
      blockedRequestId: stuck.id, maxCredits: 3, verifiedRemaining: 25,
      verifiedAt: new Date(now.getTime() - 11_000), approvedBy: "test-operator",
    },
  };
  assert.equal((await admitPaidRequest({
    ...riskInput, intentKey: `unauthorized-${randomUUID()}`,
  })).skipped, true);
  const riskAdmitted = await admitPaidRequest(riskInput);
  assert.equal(riskAdmitted.admitted, true);
  const [riskRow] = await db.select().from(oddsApiRequestsTable)
    .where(eq(oddsApiRequestsTable.id, riskAdmitted.requestId));
  assert.equal(riskRow?.metadata?.riskOverrideForRequestId, stuck.id);
  assert.equal(riskRow?.metadata?.riskVerifiedRemaining, 25);
  await db.update(oddsApiRequestsTable).set({ status: "success", creditsRemaining: 22 })
    .where(eq(oddsApiRequestsTable.id, riskAdmitted.requestId));
  assert.equal((await admitPaidRequest({
    intentKey: `later-${randomUUID()}`, requestedAt: new Date(now.getTime() - 5_000),
    expectedRequestCost: 3, metadata: {},
  })).skipped, true);
  assert.equal((await admitPaidRequest({
    ...riskInput, intentKey: `operator-one-time:${randomUUID()}`,
    requestedAt: new Date(now.getTime() - 5_000),
  })).skipped, true);
  const riskResolution = await reconcileOddsRequest({
    requestId: stuck.id, providerOutcome: "failed", billedCredits: 3,
    verifiedRemaining: 22, evidenceReference: "provider-later-receipt-123",
    evidenceCheckedAt: new Date(now.getTime() - 1_000), approvedBy: "test-operator",
  });
  assert.ok(riskResolution);
  const nextScheduled = new Date(now.getTime() + 360_000);
  await db.update(schedulerJobsTable).set({ nextRunAt: nextScheduled })
    .where(eq(schedulerJobsTable.jobKey, jobKey));
  const nextIntent = `${jobKey}:${nextScheduled.toISOString()}`;
  assert.equal((await admitPaidRequest({
    intentKey: `unapproved-again-${randomUUID()}`, requestedAt: new Date(now.getTime() + 1_000),
    expectedRequestCost: 3, metadata: {},
  })).skipped, true);
  await approveNextOddsSpend({
    requestId: stuck.id, intentKey: nextIntent, maxCredits: 3,
    approvedBy: "test-operator", approvalReference: "new-budget-approval-123",
  });
  const afterRisk = await admitPaidRequest({
    intentKey: nextIntent, requestedAt: new Date(nextScheduled.getTime() + 1000),
    expectedRequestCost: 3, metadata: { jobKey, scheduledFor: nextScheduled.toISOString() },
  });
  assert.equal(afterRisk.admitted, true);
  const [unchangedStuck] = await db.select().from(oddsApiRequestsTable)
    .where(eq(oddsApiRequestsTable.id, stuck.id));
  assert.equal(unchangedStuck?.status, "running");

  // If a risk-accepted call itself fails without quota headers, it requires
  // its own provider receipt, after which the older request remains
  // independently reconcilable.
  await db.update(oddsApiRequestsTable).set({
    status: "success", creditsRemaining: 19, requestedAt: new Date(now.getTime() - 30_000),
  }).where(eq(oddsApiRequestsTable.id, afterRisk.requestId));
  await db.update(oddsApiRequestsTable).set({ requestedAt: new Date(now.getTime() - 50_000) })
    .where(eq(oddsApiRequestsTable.id, riskAdmitted.requestId));
  const [anotherStuck] = await db.insert(oddsApiRequestsTable).values({
    intentKey: `another-stuck-${randomUUID()}`, requestedAt: new Date(now.getTime() - 20_000),
    status: "running",
  }).returning();
  const riskFailed = await admitPaidRequest({
    intentKey: `operator-one-time:${randomUUID()}`, requestedAt: new Date(now.getTime() - 10_000),
    expectedRequestCost: 3, metadata: {},
    riskApproval: { blockedRequestId: anotherStuck.id, maxCredits: 3, verifiedRemaining: 19,
      verifiedAt: new Date(now.getTime() - 11_000), approvedBy: "test-operator" },
  });
  assert.equal(riskFailed.admitted, true);
  await db.update(oddsApiRequestsTable).set({ status: "failed", creditsRemaining: null })
    .where(eq(oddsApiRequestsTable.id, riskFailed.requestId));
  await assert.rejects(reconcileOddsRequest({
    requestId: anotherStuck.id, providerOutcome: "failed", billedCredits: 0,
    verifiedRemaining: 19, evidenceReference: "original-support-receipt-456",
    evidenceCheckedAt: new Date(now.getTime() - 1_000), approvedBy: "test-operator",
  }));
  await reconcileOddsRequest({
    requestId: riskFailed.requestId, providerOutcome: "failed", billedCredits: 3,
    verifiedRemaining: 19, evidenceReference: "failed-risk-receipt-456",
    evidenceCheckedAt: new Date(now.getTime() - 1_000), approvedBy: "test-operator",
  });
  await reconcileOddsRequest({
    requestId: anotherStuck.id, providerOutcome: "failed", billedCredits: 0,
    verifiedRemaining: 19, evidenceReference: "original-support-receipt-456",
    evidenceCheckedAt: new Date(now.getTime() - 1_000), approvedBy: "test-operator",
  });
  const [originalStillRunning] = await db.select().from(oddsApiRequestsTable)
    .where(eq(oddsApiRequestsTable.id, anotherStuck.id));
  assert.equal(originalStillRunning?.status, "running");
  const finalScheduled = new Date(now.getTime() + 480_000);
  const finalIntent = `${jobKey}:${finalScheduled.toISOString()}`;
  await db.update(schedulerJobsTable).set({ nextRunAt: finalScheduled })
    .where(eq(schedulerJobsTable.jobKey, jobKey));
  await approveNextOddsSpend({
    requestId: anotherStuck.id, intentKey: finalIntent, maxCredits: 3,
    approvedBy: "test-operator", approvalReference: "both-reconciled-budget-123",
  });
  assert.equal((await admitPaidRequest({
    intentKey: finalIntent, requestedAt: new Date(finalScheduled.getTime() + 1000),
    expectedRequestCost: 3, metadata: { jobKey, scheduledFor: finalScheduled.toISOString() },
  })).admitted, true);
});