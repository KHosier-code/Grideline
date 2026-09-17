import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  db,
  pool,
  usageAnalyticsRetentionTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import dashboardRouter from "./dashboard";
import { requireAdmin } from "../middlewares/admin";

// node:test runs files in parallel, but the retention health fixture replaces
// a database singleton. Hold the same session lock as the worker tests for
// this file so those writes and reads cannot overlap.
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

type RouteLayer = {
  route?: {
    path: string;
    stack: Array<{ handle: unknown }>;
  };
};

type DataHealthHandler = (
  req: Record<string, unknown>,
  res: { json: (body: unknown) => unknown },
) => Promise<void>;

const dataHealthRoute = (dashboardRouter as unknown as { stack: RouteLayer[] }).stack
  .find((layer) => layer.route?.path === "/data-health")?.route;

assert.ok(dataHealthRoute, "the data-health route should be registered");
assert.equal(
  dataHealthRoute.stack[0]?.handle,
  requireAdmin,
  "the data-health route must remain protected by requireAdmin",
);

const dataHealthHandler = dataHealthRoute.stack.at(-1)?.handle as DataHealthHandler | undefined;
assert.ok(dataHealthHandler, "the data-health route should have a response handler");

type RetentionRow = typeof usageAnalyticsRetentionTable.$inferSelect;

async function readRetentionRow(): Promise<RetentionRow | null> {
  const [row] = await db
    .select()
    .from(usageAnalyticsRetentionTable)
    .where(eq(usageAnalyticsRetentionTable.id, 1))
    .limit(1);
  return row ?? null;
}

async function replaceRetentionRow(row: RetentionRow | null): Promise<void> {
  await db.delete(usageAnalyticsRetentionTable);
  if (row) {
    await db.insert(usageAnalyticsRetentionTable).values(row);
  }
}

async function readDataHealth(): Promise<unknown[]> {
  let responseBody: unknown;
  await dataHealthHandler!({}, {
    json(body) {
      responseBody = body;
      return body;
    },
  });
  assert.ok(responseBody, "the data-health route should return a response body");
  assert.ok(Array.isArray(responseBody), "the data-health response should be a provider list");
  return responseBody;
}

function usageRetentionProvider(body: unknown[]) {
  const provider = body.find(
    (item): item is Record<string, any> =>
      typeof item === "object"
      && item !== null
      && (item as Record<string, unknown>).provider === "usage-analytics-retention",
  );
  assert.ok(provider, "the data-health response should include Usage Lab retention");
  return provider;
}

const now = new Date();
const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

test("protected data-health reports persisted Usage Lab cleanup states without mutating retention state", async () => {
  const originalRow = await readRetentionRow();

  const cases: Array<{
    name: string;
    row: RetentionRow | null;
    expected: {
      status: string;
      cleanupState: string;
      detail: string;
      persistedStatus: string | null;
      metadataStatus: string;
    };
  }> = [
    {
      name: "pending cleanup",
      row: null,
      expected: {
        status: "stale",
        cleanupState: "pending",
        detail: "The first Usage Lab retention cleanup is pending.",
        persistedStatus: null,
        metadataStatus: "pending",
      },
    },
    {
      name: "on-time successful cleanup",
      row: {
        id: 1,
        lastAttemptAt: hourAgo,
        lastAttemptStatus: "success",
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastSuccessfulAt: hourAgo,
        lastSuccessfulDeletedEvents: 0,
        lastSuccessfulBatches: 0,
        lastSuccessfulCutoff: new Date(hourAgo.getTime() - 30 * 24 * 60 * 60 * 1000),
        latestError: null,
        latestErrorAt: null,
      },
      expected: {
        status: "current",
        cleanupState: "on_time",
        detail: "The latest Usage Lab retention cleanup completed successfully; no expired rows were found.",
        persistedStatus: "success",
        metadataStatus: "healthy",
      },
    },
    {
      name: "overdue successful cleanup",
      row: {
        id: 1,
        lastAttemptAt: twoDaysAgo,
        lastAttemptStatus: "success",
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastSuccessfulAt: twoDaysAgo,
        lastSuccessfulDeletedEvents: 2,
        lastSuccessfulBatches: 1,
        lastSuccessfulCutoff: new Date(twoDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000),
        latestError: null,
        latestErrorAt: null,
      },
      expected: {
        status: "stale",
        cleanupState: "overdue",
        detail: "The Usage Lab retention cleanup is overdue;",
        persistedStatus: "success",
        metadataStatus: "healthy",
      },
    },
    {
      name: "failed cleanup",
      row: {
        id: 1,
        lastAttemptAt: hourAgo,
        lastAttemptStatus: "failed",
        consecutiveFailures: 1,
        firstFailureAt: hourAgo,
        lastSuccessfulAt: null,
        lastSuccessfulDeletedEvents: null,
        lastSuccessfulBatches: null,
        lastSuccessfulCutoff: null,
        latestError: "database temporarily unavailable",
        latestErrorAt: hourAgo,
      },
      expected: {
        status: "unavailable",
        cleanupState: "on_time",
        detail: "The latest Usage Lab retention cleanup failed: database temporarily unavailable.",
        persistedStatus: "failed",
        metadataStatus: "failed",
      },
    },
  ];

  try {
    for (const testCase of cases) {
      await replaceRetentionRow(testCase.row);
      const before = await readRetentionRow();
      const provider = usageRetentionProvider(await readDataHealth());
      const after = await readRetentionRow();

      assert.deepEqual(after, before, `${testCase.name} must not mutate persisted retention state`);
      assert.equal(provider.status, testCase.expected.status, testCase.name);
      assert.equal(provider.metadata.cleanupState, testCase.expected.cleanupState, testCase.name);
      assert.equal(provider.metadata.lastAttemptStatus, testCase.expected.persistedStatus, testCase.name);
      assert.equal(provider.metadata.status, testCase.expected.metadataStatus, testCase.name);
      assert.match(provider.detail, new RegExp(testCase.expected.detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), testCase.name);
      assert.equal(provider.metadata.workerOwned, true, testCase.name);
      assert.equal(provider.schedule, "Every 24 hours; worker-owned", testCase.name);
      assert.equal(provider.retryPolicy, "A failed cleanup is recorded and retried on the next daily tick.", testCase.name);
    }
  } finally {
    await replaceRetentionRow(originalRow);
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