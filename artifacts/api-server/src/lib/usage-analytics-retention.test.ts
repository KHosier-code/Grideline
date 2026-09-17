import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { asc, eq } from "drizzle-orm";
import {
  db,
  pool,
  USAGE_ANALYTICS_RETENTION_DAYS,
  usageAnalyticsEventsTable,
} from "@workspace/db";
import {
  deleteExpiredUsageAnalyticsEvents,
  startUsageAnalyticsRetention,
  usageAnalyticsRetentionCutoff,
  usageAnalyticsRetentionNextCleanupAt,
} from "./usage-analytics-retention";

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

test("worker cleanup failures are contained and retried on the next tick", async () => {
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
  } finally {
    stop();
  }
});

after(async () => {
  await pool.end();
});
