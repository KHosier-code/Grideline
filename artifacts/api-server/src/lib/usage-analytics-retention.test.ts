import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { after, before } from "node:test";
import { asc, eq } from "drizzle-orm";
import {
  db,
  pool,
  USAGE_ANALYTICS_RETENTION_DAYS,
  usageAnalyticsEventsTable,
} from "@workspace/db";
import {
  createUsageAnalyticsRetentionAlert,
  deleteExpiredUsageAnalyticsEvents,
  getUsageAnalyticsRetentionHealth,
  startUsageAnalyticsRetention,
  USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD,
  usageAnalyticsRetentionCleanupState,
  usageAnalyticsRetentionCutoff,
  usageAnalyticsRetentionNextCleanupAt,
} from "./usage-analytics-retention";

// node:test runs files in parallel, but the worker health row is a database
// singleton. Hold a session lock for this file so dashboard health fixtures
// cannot replace the row while worker tests are reading or writing it.
const RETENTION_TEST_LOCK = "usage-analytics-retention-test-state";
type RetentionTestLock = {
  query: (queryText: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};
let retentionTestLock: RetentionTestLock | null = null;

before(async () => {
  retentionTestLock = await pool.connect();
  await retentionTestLock.query(
    "SELECT pg_advisory_lock(hashtext($1))",
    [RETENTION_TEST_LOCK],
  );
});

test("keeps the Usage Lab report window inside the documented retention period", () => {
  assert.equal(USAGE_ANALYTICS_RETENTION_DAYS, 30);
  const now = new Date("2026-09-17T12:00:00.000Z");
  assert.equal(
    usageAnalyticsRetentionCutoff(now).toISOString(),
    "2026-08-18T12:00:00.000Z",
  );
});

test("retention cutoff preserves the exact timestamp boundary", () => {
  const now = new Date("2026-09-17T12:00:00.123Z");
  const cutoff = usageAnalyticsRetentionCutoff(now);
  assert.equal(cutoff.getUTCMilliseconds(), 123);
  assert.equal(cutoff.getTime(), now.getTime() - 30 * 24 * 60 * 60 * 1000);
});

test("retention alert activates only after repeated failures and stays scoped to Usage Lab cleanup", () => {
  const firstFailureAt = new Date("2026-09-17T12:00:00.000Z");
  const latestFailureAt = new Date("2026-09-19T12:00:00.000Z");
  const input = {
    firstFailureAt,
    latestFailureAt,
    latestError: "simulated retention failure",
  };

  assert.equal(
    createUsageAnalyticsRetentionAlert({
      ...input,
      consecutiveFailures: USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD - 1,
    }),
    null,
  );

  assert.deepEqual(
    createUsageAnalyticsRetentionAlert({
      ...input,
      consecutiveFailures: USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD,
    }),
    {
      code: "repeated_failures",
      severity: "critical",
      scope: "usage-analytics-retention",
      title: "Usage Lab retention cleanup repeatedly failing",
      detail: "Usage Lab retention cleanup has failed 3 consecutive times. Storage may exceed the 30-day retention policy until the worker recovers.",
      consecutiveFailures: 3,
      firstFailureAt,
      latestFailureAt,
      latestError: "simulated retention failure",
    },
  );
});

test("next cleanup is pending before the worker records its first attempt", () => {
  assert.equal(usageAnalyticsRetentionNextCleanupAt(null), null);
});

test("next cleanup is derived from the last worker attempt and daily cadence", () => {
  const lastAttemptAt = new Date("2026-09-17T12:00:00.123Z");
  assert.equal(
    usageAnalyticsRetentionNextCleanupAt(lastAttemptAt)?.toISOString(),
    "2026-09-18T12:00:00.123Z",
  );
  assert.equal(
    usageAnalyticsRetentionNextCleanupAt(lastAttemptAt, 60 * 60 * 1000)?.toISOString(),
    "2026-09-17T13:00:00.123Z",
  );
});

test("cleanup schedule is pending before the worker records its first attempt", () => {
  assert.equal(
    usageAnalyticsRetentionCleanupState(null, new Date("2026-09-17T12:00:00.000Z")),
    "pending",
  );
});

test("cleanup schedule is on time until the expected next timestamp has passed", () => {
  const nextCleanupAt = new Date("2026-09-18T12:00:00.000Z");
  assert.equal(
    usageAnalyticsRetentionCleanupState(nextCleanupAt, new Date("2026-09-18T12:00:00.000Z")),
    "on_time",
  );
  assert.equal(
    usageAnalyticsRetentionCleanupState(nextCleanupAt, new Date("2026-09-18T11:59:59.999Z")),
    "on_time",
  );
});

test("cleanup schedule is overdue after the expected next timestamp", () => {
  assert.equal(
    usageAnalyticsRetentionCleanupState(
      new Date("2026-09-18T12:00:00.000Z"),
      new Date("2026-09-18T12:00:00.001Z"),
    ),
    "overdue",
  );
});

test("database cleanup removes only expired events and preserves the seven-day report window", async () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  const eventName = `retention-integration-${randomUUID()}`;
  const cutoff = usageAnalyticsRetentionCutoff(now);
  const oldEventTime = new Date(cutoff.getTime() - 1);
  const freshEventTime = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

  await db.insert(usageAnalyticsEventsTable).values([
    { eventName, value: "expired", createdAt: oldEventTime },
    { eventName, value: "at-cutoff", createdAt: cutoff },
    { eventName, value: "fresh", createdAt: freshEventTime },
  ]).returning({ id: usageAnalyticsEventsTable.id });

  try {
    const result = await deleteExpiredUsageAnalyticsEvents(now);
    assert.equal(result.deletedEvents, 1);
    assert.equal(result.cutoff.toISOString(), cutoff.toISOString());
    assert.equal(result.retentionDays, USAGE_ANALYTICS_RETENTION_DAYS);

    const remaining = await db.select({
      value: usageAnalyticsEventsTable.value,
      createdAt: usageAnalyticsEventsTable.createdAt,
    }).from(usageAnalyticsEventsTable)
      .where(eq(usageAnalyticsEventsTable.eventName, eventName))
      .orderBy(asc(usageAnalyticsEventsTable.createdAt));

    assert.deepEqual(
      remaining.map(({ value, createdAt }) => ({ value, createdAt: createdAt.toISOString() })),
      [
        { value: "at-cutoff", createdAt: cutoff.toISOString() },
        { value: "fresh", createdAt: freshEventTime.toISOString() },
      ],
    );
    assert.ok(
      remaining.some(
        ({ value, createdAt }) =>
          value === "fresh"
          && createdAt.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000,
      ),
    );
  } finally {
    await db.delete(usageAnalyticsEventsTable).where(eq(usageAnalyticsEventsTable.eventName, eventName));
  }
});

test("database cleanup removes expired events across multiple batches", async () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  const eventName = `retention-large-integration-${randomUUID()}`;
  const cutoff = usageAnalyticsRetentionCutoff(now);
  const expiredEventCount = 1_001;
  const expiredEventTime = new Date(cutoff.getTime() - 1);
  const freshEventTime = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

  await db.insert(usageAnalyticsEventsTable).values([
    ...Array.from({ length: expiredEventCount }, (_, index) => ({
      eventName,
      value: `expired-${index}`,
      createdAt: expiredEventTime,
    })),
    { eventName, value: "fresh", createdAt: freshEventTime },
  ]);

  try {
    const result = await deleteExpiredUsageAnalyticsEvents(now);
    assert.equal(result.deletedEvents, expiredEventCount);
    assert.equal(result.batches, 2);

    const remaining = await db.select({
      value: usageAnalyticsEventsTable.value,
      createdAt: usageAnalyticsEventsTable.createdAt,
    }).from(usageAnalyticsEventsTable)
      .where(eq(usageAnalyticsEventsTable.eventName, eventName));

    assert.deepEqual(
      remaining.map(({ value, createdAt }) => ({
        value,
        createdAt: createdAt.toISOString(),
      })),
      [{ value: "fresh", createdAt: freshEventTime.toISOString() }],
    );
  } finally {
    await db.delete(usageAnalyticsEventsTable).where(eq(usageAnalyticsEventsTable.eventName, eventName));
  }
});

test("worker cleanup failures are contained and retried on the next tick", { concurrency: false }, async () => {
  let attempts = 0;
  const stop = startUsageAnalyticsRetention({
    intervalMs: 10,
    cleanup: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("simulated retention failure");
      return {
        deletedEvents: 0,
        batches: 1,
        cutoff: new Date("2026-09-17T12:00:00.000Z"),
        retentionDays: USAGE_ANALYTICS_RETENTION_DAYS,
      };
    },
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.ok(attempts >= 2, `expected a retry after failure, got ${attempts} attempt(s)`);
    const health = await getUsageAnalyticsRetentionHealth();
    assert.equal(health.status, "healthy");
    assert.equal(health.consecutiveFailures, 0);
    assert.equal(health.alert, null);
    assert.equal(health.latestError, "simulated retention failure");
  } finally {
    stop();
  }
});

test("worker persists a critical alert after repeated cleanup failures", { concurrency: false }, async () => {
  let attempts = 0;
  const stop = startUsageAnalyticsRetention({
    intervalMs: 10,
    cleanup: async () => {
      attempts += 1;
      throw new Error("repeated retention failure");
    },
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(attempts >= USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD);
    const health = await getUsageAnalyticsRetentionHealth();
    assert.equal(health.lastAttemptStatus, "failed");
    assert.equal(health.consecutiveFailures >= USAGE_ANALYTICS_RETENTION_REPEATED_FAILURE_THRESHOLD, true);
    assert.equal(health.alert?.scope, "usage-analytics-retention");
    assert.equal(health.alert?.severity, "critical");
    assert.equal(health.alert?.latestError, "repeated retention failure");
  } finally {
    stop();
  }
});

after(async () => {
  if (retentionTestLock) {
    try {
      await retentionTestLock.query(
        "SELECT pg_advisory_unlock(hashtext($1))",
        [RETENTION_TEST_LOCK],
      );
    } finally {
      retentionTestLock.release();
      retentionTestLock = null;
    }
  }
  await pool.end();
});
